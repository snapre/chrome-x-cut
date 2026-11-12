importScripts("url-utils.js", "save-queue.js");

const HOST_NAME = "com.codex.x_photo_saver";
const MENU_ID = "save-social-original-photo";
const OPTIONS_SCHEMA_VERSION = 5;
const DEFAULT_OPTIONS = {
  mode: "photos",
  subdirectory: "X Images",
  albumId: "",
  albumName: "",
  keepFileAfterPhotosImport: false,
  optionsSchemaVersion: OPTIONS_SCHEMA_VERSION
};

chrome.runtime.onInstalled.addListener(() => {
  migrateOptions();
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({
    id: MENU_ID,
    title: "Save original social photo",
    contexts: ["image"],
    documentUrlPatterns: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://threads.com/*",
      "https://*.threads.com/*",
      "https://threads.net/*",
      "https://*.threads.net/*",
      "https://instagram.com/*",
      "https://*.instagram.com/*"
    ],
    targetUrlPatterns: [
      "https://pbs.twimg.com/media/*",
      "https://*.cdninstagram.com/*",
      "https://*.fbcdn.net/*"
    ]
  }));
});

chrome.runtime.onStartup.addListener(migrateOptions);
migrateOptions();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) {
    return;
  }

  const origin = tab ? { tabId: tab.id, frameId: info.frameId, documentUrl: info.frameUrl || tab.url } : null;
  enqueuePhoto(info.srcUrl, info.pageUrl || (tab && tab.url), origin).then((result) => {
    notifyOrigin(origin, { type: "X_QUEUE_RESULT", srcUrl: info.srcUrl, result });
  }).catch((error) => {
    notifyOrigin(origin, { type: "X_QUEUE_RESULT", result: { ok: false, error: error.message } });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let request;
  switch (message?.type) {
    case "X_LIST_PHOTOS_ALBUMS":
      request = listPhotosAlbums();
      break;
    case "X_SAVE_PHOTO": {
      const origin = sender.tab ? {
        tabId: sender.tab.id,
        documentId: sender.documentId,
        frameId: sender.frameId,
        documentUrl: sender.url
      } : null;
      request = enqueuePhoto(message.srcUrl, message.pageUrl || sender.url, origin);
      break;
    }
    case "X_RETRY_PHOTO":
      if (sender.url !== chrome.runtime.getURL("src/popup.html")) {
        return undefined;
      }
      request = retryPhoto(message.jobId, message.useCurrentDestination);
      break;
    default:
      return undefined;
  }

  request.then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

function getOptions() {
  return chrome.storage.sync.get(DEFAULT_OPTIONS);
}

function migrateOptions() {
  chrome.storage.sync.get(["albumId", "albumName", "optionsSchemaVersion"], (items) => {
    if (chrome.runtime.lastError) {
      return;
    }

    if ((items.optionsSchemaVersion || 0) >= OPTIONS_SCHEMA_VERSION) {
      return;
    }

    chrome.storage.sync.set({
      albumId: typeof items.albumId === "string" ? items.albumId : "",
      albumName: typeof items.albumName === "string" ? items.albumName : "",
      optionsSchemaVersion: OPTIONS_SCHEMA_VERSION
    });
  });
}

async function listPhotosAlbums() {
  const nativeResult = await saveWithNativeHost({ action: "listAlbums" });
  if (!nativeResult.ok) {
    return {
      ok: false,
      error: nativeResult.error || "无法读取 Photos 相册。"
    };
  }

  const albums = Array.isArray(nativeResult.albums) ? nativeResult.albums.filter((album) => {
    return album && typeof album.id === "string" && typeof album.name === "string";
  }) : [];
  return { ok: true, albums };
}

function saveWithNativeHost(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, payload, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      resolve(response || { ok: false, error: "Native helper returned no response." });
    });
  });
}
