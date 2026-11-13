(function initPopup() {
  "use strict";

  const DEFAULT_OPTIONS = {
    mode: "photos",
    albumId: "",
    albumName: "",
    keepFileAfterPhotosImport: false,
    subdirectory: "X Images",
    optionsSchemaVersion: 5
  };

  const saveButton = document.getElementById("save");
  const saveIcon = document.getElementById("saveIcon");
  const saveLabel = document.getElementById("saveLabel");
  const modeSelect = document.getElementById("mode");
  const albumRow = document.getElementById("albumRow");
  const albumSelect = document.getElementById("albumSelect");
  const refreshAlbumsButton = document.getElementById("refreshAlbums");
  const albumHint = document.getElementById("albumHint");
  const keepFileCheckbox = document.getElementById("keepFile");
  const keepFileRow = document.getElementById("keepFileRow");
  const status = document.getElementById("status");
  const settings = document.getElementById("settings");
  const history = document.getElementById("history");
  const historySummary = document.getElementById("historySummary");
  const emptyHistory = document.getElementById("emptyHistory");
  const queueKey = "cutJobs";
  const statusLabels = {
    queued: "排队中",
    saving: "保存中",
    success: "成功",
    failed: "失败",
    uncertain: "待确认"
  };
  const platformLabels = { x: "X", threads: "Threads", instagram: "Instagram" };
  const timeFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" });
  let jobs = [];
  let loadedJobs = false;
  let currentOptions = DEFAULT_OPTIONS;
  let restoredAlbumId = "";
  let restoredAlbumName = "";
  let albumsLoaded = false;
  let loadingAlbums = false;
  let saveFeedbackTimer = 0;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[queueKey]) {
      loadedJobs = true;
      jobs = changes[queueKey].newValue || [];
      renderHistory();
    }
    if (area === "sync") {
      updateHistoryOptions();
    }
  });
  restoreOptions();
  chrome.storage.local.get({ [queueKey]: [] }).then((stored) => {
    if (!loadedJobs) {
      jobs = stored[queueKey];
      renderHistory();
    }
  }).catch((error) => setStatus(`无法读取 Cut 记录：${error.message}`, true));

  saveButton.addEventListener("click", saveFromActiveTab);
  modeSelect.addEventListener("change", handleModeChange);
  albumSelect.addEventListener("change", persistOptions);
  refreshAlbumsButton.addEventListener("click", loadAlbums);
  settings.addEventListener("toggle", () => {
    if (settings.open && modeSelect.value === "photos" && !albumsLoaded) {
      loadAlbums();
    }
  });
  keepFileCheckbox.addEventListener("change", persistOptions);

  function restoreOptions() {
    chrome.storage.sync.get(DEFAULT_OPTIONS, (items) => {
      currentOptions = items;
      modeSelect.value = items.mode || DEFAULT_OPTIONS.mode;
      restoredAlbumId = typeof items.albumId === "string" ? items.albumId : "";
      restoredAlbumName = typeof items.albumName === "string" ? items.albumName : "";
      keepFileCheckbox.checked = Boolean(items.keepFileAfterPhotosImport);
      updateModeFields();
      renderHistory();
      if (settings.open && modeSelect.value === "photos" && !albumsLoaded) {
        loadAlbums();
      }
    });
  }

  function handleModeChange() {
    updateModeFields();
    persistOptions();
    if (modeSelect.value === "photos" && !albumsLoaded) {
      loadAlbums();
    }
  }

  function updateModeFields() {
    const photosMode = modeSelect.value === "photos";
    albumRow.hidden = !photosMode;
    keepFileRow.hidden = !photosMode;
    albumSelect.disabled = !photosMode || !albumsLoaded || loadingAlbums;
    refreshAlbumsButton.disabled = !photosMode || loadingAlbums;
  }

  function persistOptions() {
    const selectedAlbum = albumSelect.options[albumSelect.selectedIndex];
    const albumId = albumsLoaded ? albumSelect.value : restoredAlbumId;
    const albumName = albumsLoaded ?
      (albumId && selectedAlbum ? selectedAlbum.dataset.albumName || selectedAlbum.textContent : "") :
      restoredAlbumName;
    chrome.storage.sync.set({
      mode: modeSelect.value,
      albumId,
      albumName,
      keepFileAfterPhotosImport: keepFileCheckbox.checked,
      optionsSchemaVersion: DEFAULT_OPTIONS.optionsSchemaVersion
    });
    restoredAlbumId = albumId;
    restoredAlbumName = albumName;
  }

  async function loadAlbums() {
    if (loadingAlbums) return;
    loadingAlbums = true;
    albumSelect.disabled = true;
    refreshAlbumsButton.disabled = true;
    albumHint.textContent = "正在读取 Photos 相册…";

    try {
      const response = await sendRuntimeMessage({ type: "X_LIST_PHOTOS_ALBUMS" });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "无法读取 Photos 相册。");
      }

      const albums = Array.isArray(response.albums) ? response.albums : [];
      replaceAlbumOptions(albums);
      albumsLoaded = true;
      albumHint.textContent = albums.length ? `已读取 ${albums.length} 个普通相册。` : "没有找到普通相册。";
      if (!restoredAlbumId && albumSelect.value) {
        persistOptions();
      }
    } catch (error) {
      albumsLoaded = false;
      albumHint.textContent = `读取失败：${error.message}`;
    } finally {
      loadingAlbums = false;
      updateModeFields();
    }
  }

  function replaceAlbumOptions(albums) {
    albumSelect.replaceChildren();
    albumSelect.appendChild(createAlbumOption("", "Photos 图库（不指定相册）"));

    for (const album of albums) {
      if (!album || typeof album.id !== "string" || typeof album.name !== "string") {
        continue;
      }
      albumSelect.appendChild(createAlbumOption(album.id, album.name));
    }

    const restoredById = albums.find((album) => album.id === restoredAlbumId);
    const restoredByName = !restoredAlbumId && restoredAlbumName ?
      albums.find((album) => album.name === restoredAlbumName) :
      null;
    if (restoredAlbumId && !restoredById) {
      const missing = createAlbumOption(restoredAlbumId, restoredAlbumName || "原相册");
      missing.textContent += "（已不可用）";
      missing.disabled = true;
      albumSelect.appendChild(missing);
    }
    albumSelect.value = restoredById?.id || restoredByName?.id || restoredAlbumId;
  }

  function createAlbumOption(id, name) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    option.dataset.albumName = id ? name : "";
    return option;
  }

  async function saveFromActiveTab() {
    const preparedAudio = CutShutterSound.prepare();
    window.clearTimeout(saveFeedbackTimer);
    setStatus("");
    setSaveFeedback("正在加入队列…");
    saveButton.disabled = true;

    try {
      const [tab] = await queryActiveTab();
      if (!tab || !tab.id) {
        throw new Error("找不到当前标签页。");
      }

      const response = await sendTabMessage(tab.id, { type: "X_GET_AND_SAVE" });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "没有找到当前图片。");
      }

      setSaveFeedback(response.duplicate ? "已在队列中" : "已加入队列", true);
      saveFeedbackTimer = window.setTimeout(setSaveFeedback, 1200);
      if (!response.duplicate) {
        CutShutterSound.play(preparedAudio).catch(() => {});
      }
    } catch (error) {
      setSaveFeedback();
      setStatus(error.message, true);
    } finally {
      saveButton.disabled = false;
    }
  }

  function setSaveFeedback(label = "保存当前原图", queued = false) {
    saveButton.classList.toggle("is-queued", queued);
    saveIcon.textContent = queued ? "✓" : "↓";
    saveLabel.textContent = label;
  }

  function updateHistoryOptions() {
    chrome.storage.sync.get(DEFAULT_OPTIONS, (items) => {
      if (!chrome.runtime.lastError) {
        currentOptions = items;
        renderHistory();
      }
    });
  }

  function renderHistory() {
    const pending = jobs.filter((job) => job.status === "queued" || job.status === "saving").length;
    const issues = jobs.filter((job) => job.status === "failed" || job.status === "uncertain").length;
    const summary = [];
    if (pending) summary.push(`${pending} 张待保存`);
    if (issues) summary.push(`${issues} 张待处理`);
    historySummary.textContent = summary.join(" · ");
    emptyHistory.hidden = jobs.length > 0;
    const sorted = [...jobs].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
    history.replaceChildren(...sorted.map(createHistoryRow));
  }

  function createHistoryRow(job) {
    const row = document.createElement("li");
    row.className = "history-row";

    const preview = document.createElement("div");
    preview.className = "preview";
    preview.setAttribute("aria-hidden", "true");
    preview.textContent = platformLabels[job.platform] || "";
    if (job.thumbnail) {
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove(), { once: true });
      image.src = job.thumbnail;
      preview.appendChild(image);
    }

    const info = document.createElement("div");
    const heading = document.createElement("div");
    heading.className = "history-title";
    const filename = document.createElement(job.pageUrl ? "a" : "span");
    filename.className = "history-filename";
    filename.textContent = job.filename;
    filename.title = job.pageUrl ? `打开原帖 · ${job.filename}` : job.filename;
    if (job.pageUrl) {
      filename.href = job.pageUrl;
      filename.target = "_blank";
      filename.rel = "noopener noreferrer";
    }
    const state = document.createElement("span");
    state.className = "history-state";
    state.dataset.state = job.status;
    state.textContent = statusLabels[job.status];
    heading.append(filename, state);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const destination = job.destination.mode === "photos" ?
      job.destination.albumName || "Photos 图库" :
      `下载目录 / ${job.destination.subdirectory}`;
    const details = [platformLabels[job.platform], timeFormat.format(job.createdAt), destination];
    if (job.retries) details.push(`重试 ${job.retries} 次`);
    meta.textContent = details.join(" · ");
    info.append(heading, meta);

    if (job.error) {
      const error = document.createElement("p");
      error.className = "history-error";
      error.textContent = job.error;
      info.appendChild(error);
    }

    if (job.status === "failed" || job.status === "uncertain") {
      const actions = document.createElement("div");
      actions.className = "history-actions";
      actions.appendChild(makeRetryButton(job, false));
      const differentDestination = currentOptions.mode !== job.destination.mode ||
        (job.destination.mode === "photos" && currentOptions.albumId !== job.destination.albumId) ||
        (job.destination.mode === "download" && currentOptions.subdirectory &&
          currentOptions.subdirectory !== job.destination.subdirectory);
      if (differentDestination) {
        actions.appendChild(makeRetryButton(job, true));
      }
      info.appendChild(actions);
    }

    row.append(preview, info);
    return row;
  }

  function makeRetryButton(job, useCurrentDestination) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary retry";
    button.textContent = useCurrentDestination ? "按当前设置重试" :
      job.status === "uncertain" ? "确认后重试" : "重试";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await sendRuntimeMessage({ type: "X_RETRY_PHOTO", jobId: job.id, useCurrentDestination });
        if (!response?.ok) {
          throw new Error(response?.error || "未能重新加入队列。");
        }
        setStatus("已重新加入队列。");
      } catch (error) {
        setStatus(error.message, true);
        button.disabled = false;
      }
    });
    return button;
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error("请先打开 X、Threads 或 Instagram 图片页面。"));
          return;
        }
        resolve(response);
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }
})();
