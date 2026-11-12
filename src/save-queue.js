const QUEUE_KEY = "cutJobs";
const QUEUE_ALARM = "cut-queue";
const MAX_SUCCESS_RECORDS = 100;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const PHOTOS_TIMEOUT_MS = 3 * 60_000;

let queueWrites = Promise.resolve();
let processing = false;
let wakeRequested = false;

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    wakeQueue();
  }
});
chrome.downloads.onErased.addListener(wakeQueue);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === QUEUE_ALARM) {
    wakeQueue();
  }
});
chrome.runtime.onStartup.addListener(wakeQueue);
chrome.runtime.onInstalled.addListener(wakeQueue);
withQueue(updateQueueBadge).catch(console.error);
wakeQueue();

function withQueue(operation) {
  const result = queueWrites.then(async () => {
    const stored = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
    return operation(stored[QUEUE_KEY]);
  });
  queueWrites = result.catch(() => {});
  return result;
}

async function writeQueue(jobs) {
  // Keep every unfinished or failed job, and retain the latest completed saves.
  const successes = jobs.filter((job) => job.status === "success")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const expired = new Set(successes.slice(MAX_SUCCESS_RECORDS).map((job) => job.id));
  const retained = jobs.filter((job) => !expired.has(job.id));
  await chrome.storage.local.set({ [QUEUE_KEY]: retained });
  updateQueueBadge(retained);
}

function updateQueueBadge(jobs) {
  const count = jobs.filter((job) => job.status === "failed" || job.status === "uncertain").length;
  chrome.action.setBadgeText({ text: count > 99 ? "99+" : count ? String(count) : "" }).catch(console.error);
  chrome.action.setBadgeBackgroundColor({ color: "#B42318" }).catch(console.error);
}

async function ensureQueueAlarm() {
  if (!await chrome.alarms.get(QUEUE_ALARM)) {
    await chrome.alarms.create(QUEUE_ALARM, { periodInMinutes: 1 });
  }
}

async function getDestination() {
  const options = await getOptions();
  if (options.mode === "photos") {
    return {
      mode: "photos",
      albumId: options.albumId || "",
      albumName: options.albumName || "",
      keepFile: Boolean(options.keepFileAfterPhotosImport)
    };
  }
  return {
    mode: "download",
    subdirectory: XPhotoSaverUrlUtils.sanitizeFilenamePart(options.subdirectory || DEFAULT_OPTIONS.subdirectory)
  };
}

function destinationKey(destination) {
  return destination.mode === "photos" ?
    JSON.stringify(["photos", destination.albumId]) :
    JSON.stringify(["download", destination.subdirectory]);
}

function isDuplicate(jobs, mediaKey, destination) {
  return jobs.some((job) => (job.status === "queued" || job.status === "saving") &&
    job.mediaKey === mediaKey && destinationKey(job.destination) === destinationKey(destination));
}

function safeSourcePage(pageUrl) {
  if (!XPhotoSaverUrlUtils.getPlatformFromPageUrl(pageUrl)) {
    return "";
  }
  const url = new URL(pageUrl);
  return url.protocol === "https:" ? url.origin + url.pathname : "";
}

async function enqueuePhoto(srcUrl, sourcePage, origin) {
  const pageUrl = safeSourcePage(sourcePage);
  const image = XPhotoSaverUrlUtils.normalizeMediaImageUrl(srcUrl, pageUrl);
  const imageUrl = new URL(image.url);
  const thumbnail = new URL(image.url);
  if (image.platform === "x") {
    thumbnail.searchParams.set("name", "small");
  }

  // Ignore CDN signature and size parameters when comparing pending saves.
  const mediaKey = JSON.stringify([image.platform, imageUrl.pathname.replace(/\.[a-z0-9]+$/i, "")]);
  const result = await withQueue(async (jobs) => {
    const destination = await getDestination();
    if (isDuplicate(jobs, mediaKey, destination)) {
      return { ok: true, duplicate: true };
    }

    const now = Date.now();
    const job = {
      id: crypto.randomUUID(),
      mediaKey,
      platform: image.platform,
      url: image.url,
      thumbnail: thumbnail.href,
      pageUrl,
      filename: XPhotoSaverUrlUtils.makeImageFilename({
        platform: image.platform,
        statusId: XPhotoSaverUrlUtils.getPostIdFromPageUrl(pageUrl),
        mediaId: image.mediaId,
        extension: image.extension
      }),
      destination,
      origin,
      status: "queued",
      retries: 0,
      createdAt: now,
      updatedAt: now
    };
    await ensureQueueAlarm();
    await writeQueue([...jobs, job]);
    return { ok: true, jobId: job.id };
  });
  wakeQueue();
  return result;
}

async function retryPhoto(jobId, useCurrentDestination) {
  const result = await withQueue(async (jobs) => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || !["failed", "uncertain"].includes(job.status)) {
      throw new Error("这条记录当前无法重试。");
    }

    const destination = useCurrentDestination ? await getDestination() : job.destination;
    if (isDuplicate(jobs, job.mediaKey, destination)) {
      throw new Error("这张图片已在同一保存位置的队列中。");
    }

    // Use the same record and move it to the back of the queue.
    const retry = {
      ...job,
      destination,
      status: "queued",
      retries: job.retries + 1,
      updatedAt: Date.now()
    };
    delete retry.error;
    delete retry.downloadId;
    delete retry.startedAt;
    await ensureQueueAlarm();
    await writeQueue([...jobs.filter((item) => item.id !== jobId), retry]);
    return { ok: true, jobId };
  });
  wakeQueue();
  return result;
}

function wakeQueue() {
  wakeRequested = true;
  if (!processing) {
    void processQueue();
  }
}

async function processQueue() {
  processing = true;
  try {
    while (wakeRequested) {
      wakeRequested = false;
      const job = await withQueue(async (jobs) => {
        const active = jobs.find((item) => item.status === "saving");
        if (active) {
          await ensureQueueAlarm();
          return { ...active, resumed: true };
        }

        const next = jobs.find((item) => item.status === "queued");
        if (!next) {
          await chrome.alarms.clear(QUEUE_ALARM);
          return null;
        }
        await ensureQueueAlarm();
        Object.assign(next, { status: "saving", startedAt: Date.now(), updatedAt: Date.now() });
        await writeQueue(jobs);
        return next;
      });
      if (job) {
        await processJob(job);
      }
    }
  } catch (error) {
    // The alarm or next extension event can recover after a storage/API failure.
    console.error("Cut queue:", error);
  } finally {
    processing = false;
    if (wakeRequested) {
      wakeQueue();
    }
  }
}

async function processJob(job) {
  if (Number.isInteger(job.downloadId)) {
    await reconcileDownload(job);
    return;
  }

  if (job.resumed) {
    await finishJob(job, "uncertain", "保存中断，无法确认文件是否已保存。请先检查保存位置。");
    return;
  }

  if (job.destination.mode === "photos") {
    const result = await importQueuedPhoto(job).catch((error) => ({ error: error.message }));
    if (result.ok && result.imported) {
      await finishJob(job, "success");
    } else {
      const status = result.uncertain ? "uncertain" : "failed";
      await finishJob(job, status, describeFailure(job, result.error));
    }
    return;
  }

  let downloadId;
  try {
    downloadId = await chrome.downloads.download({
      url: job.url,
      filename: `${job.destination.subdirectory}/${job.filename}`,
      saveAs: false,
      conflictAction: "uniquify"
    });
  } catch (error) {
    await finishJob(job, "failed", describeFailure(job, error.message));
    return;
  }

  await withQueue(async (jobs) => {
    const current = jobs.find((item) => item.id === job.id);
    current.downloadId = downloadId;
    await writeQueue(jobs);
  });
  // A small file can finish before its ID is recorded.
  await reconcileDownload({ ...job, downloadId });
}

async function reconcileDownload(job) {
  const [item] = await chrome.downloads.search({ id: job.downloadId });
  if (item?.state === "complete") {
    await finishJob(job, "success");
  } else if (item?.state === "interrupted") {
    await finishJob(job, "failed", describeFailure(job, item.error));
  } else if (!item) {
    await finishJob(job, "uncertain", "找不到下载记录，请先检查下载目录。");
  } else if (Date.now() - job.startedAt >= DOWNLOAD_TIMEOUT_MS) {
    // Recheck after cancellation in case Chrome finished just before it arrived.
    await chrome.downloads.cancel(job.downloadId);
    const [finalItem] = await chrome.downloads.search({ id: job.downloadId });
    if (finalItem?.state === "complete") {
      await finishJob(job, "success");
    } else if (finalItem?.state === "interrupted") {
      await finishJob(job, "failed", "下载超时，请重试。");
    } else {
      await finishJob(job, "uncertain", "下载超时，请先检查下载目录。");
    }
  }
}

async function finishJob(job, status, error = "") {
  await withQueue(async (jobs) => {
    const current = jobs.find((item) => item.id === job.id);
    Object.assign(current, { status, error, updatedAt: Date.now() });
    if (status === "success") {
      delete current.url;
      delete current.mediaKey;
      delete current.origin;
    }
    await writeQueue(jobs);
  });
  if (status === "success") {
    notifyOrigin(job.origin, { type: "X_SAVE_RESULT", result: { ok: true } });
  }
  wakeRequested = true;
}

function describeFailure(job, error) {
  const detail = String(error || "").replace(/https?:\/\/[^\s"'<>]+/g, "[图片链接]").slice(0, 240);
  if (/host not found|specified native messaging host|access to the specified native messaging/i.test(detail)) {
    return "无法连接 Photos 助手，请检查助手是否已安装并授权。";
  }
  if (/album no longer exists/i.test(detail)) {
    return "原相册已删除。请在设置里选择相册，再按当前设置重试。";
  }
  if (/not authorized|not permitted|-1743\b/i.test(detail)) {
    return "Photos 导入权限不足，请检查 macOS 的自动化权限后重试。";
  }
  if (job.platform !== "x" && (/\b(403|404|410)\b|SERVER_(FORBIDDEN|BAD_CONTENT|UNAUTHORIZED)/i.test(detail))) {
    return "图片链接可能已过期，请打开原帖重新 Cut。";
  }
  return detail || "保存失败，请重试。";
}

function importQueuedPhoto(job) {
  // A native port keeps the worker alive while Photos downloads and imports.
  return new Promise((resolve) => {
    const port = chrome.runtime.connectNative(HOST_NAME);
    const timer = setTimeout(() => {
      port.disconnect();
      resolve({ uncertain: true, error: "Photos 导入超时，请先检查图库。" });
    }, PHOTOS_TIMEOUT_MS);
    port.onMessage.addListener((response) => {
      clearTimeout(timer);
      port.disconnect();
      if (response?.ok === false && /osascript.*timed out/i.test(response.error || "")) {
        resolve({ uncertain: true, error: "Photos 导入超时，请先检查图库。" });
      } else {
        resolve(response || {});
      }
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const error = chrome.runtime.lastError?.message || "";
      const missing = /host not found|specified native messaging host/i.test(error);
      resolve(missing ? { error } : {
        uncertain: true,
        error: "Photos 助手连接中断，请先检查图库。"
      });
    });
    try {
      port.postMessage({
        url: job.url,
        filename: job.filename,
        albumId: job.destination.albumId,
        albumName: job.destination.albumName,
        keepFile: job.destination.keepFile
      });
    } catch (error) {
      clearTimeout(timer);
      port.disconnect();
      resolve({ uncertain: true, error: error.message });
    }
  });
}

function notifyOrigin(origin, message) {
  if (!Number.isInteger(origin?.tabId)) {
    return;
  }
  const target = origin.documentId ? { documentId: origin.documentId } : { frameId: origin.frameId ?? 0 };
  chrome.tabs.sendMessage(origin.tabId, { ...message, documentUrl: origin.documentUrl }, target).catch(() => {});
}
