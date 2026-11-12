import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const urlUtils = readFileSync(new URL("../src/url-utils.js", import.meta.url), "utf8");
const queue = readFileSync(new URL("../src/save-queue.js", import.meta.url), "utf8");
const pageUrl = "https://x.com/example/status/123";
const origin = { tabId: 8, documentId: "test-document", documentUrl: pageUrl };
const photoUrl = (id) => `https://pbs.twimg.com/media/${id}?format=jpg&name=small`;

function event() {
  const listeners = [];
  return {
    addListener: (listener) => listeners.push(listener),
    emit: (...args) => listeners.forEach((listener) => listener(...args))
  };
}

function startWorker(stored = [], mode = "photos") {
  let jobs = structuredClone(stored);
  let alarm;
  const imports = [];
  const notices = [];
  const downloads = new Map();
  const changed = event();
  const options = { mode, subdirectory: "X Images", albumId: "first", albumName: "First" };
  const chrome = {
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    alarms: {
      get: async () => alarm,
      create: async (name) => { alarm = { name }; },
      clear: async () => { alarm = undefined; },
      onAlarm: event()
    },
    downloads: {
      download: async (config) => {
        const id = downloads.size + 1;
        downloads.set(id, { config, state: "in_progress" });
        return id;
      },
      search: async ({ id }) => downloads.has(id) ? [downloads.get(id)] : [],
      onChanged: changed,
      onErased: event()
    },
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      connectNative: () => {
        const port = {
          onMessage: event(),
          onDisconnect: event(),
          disconnect: () => {},
          postMessage: (payload) => {
            imports.push({ payload, reply: (result) => port.onMessage.emit(result) });
          }
        };
        return port;
      }
    },
    storage: {
      local: {
        get: async () => ({ cutJobs: structuredClone(jobs) }),
        set: async ({ cutJobs }) => { jobs = structuredClone(cutJobs); }
      }
    },
    tabs: {
      sendMessage: async (tabId, message, target) => { notices.push({ tabId, message, target }); }
    }
  };
  const api = runInNewContext(urlUtils + "\n" + queue + "\n({ enqueuePhoto, retryPhoto })", {
    chrome,
    crypto: { randomUUID },
    DEFAULT_OPTIONS: options,
    HOST_NAME: "test",
    getOptions: async () => ({ ...options }),
    URL,
    console,
    setTimeout: (...args) => setTimeout(...args).unref(),
    clearTimeout
  });
  return {
    jobs: () => jobs,
    enqueue: (id) => api.enqueuePhoto(photoUrl(id), pageUrl, origin),
    retry: api.retryPhoto,
    completeDownload(id) {
      downloads.get(id).state = "complete";
      changed.emit({ id, state: { current: "complete" } });
    },
    imports,
    options,
    notices,
    downloads
  };
}

async function waitFor(condition) {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("Timed out waiting for the queue");
}

test("ten rapid clicks are accepted before the first Photos import finishes", async () => {
  const worker = startWorker();
  const accepted = await Promise.all(Array.from({ length: 10 }, (_, i) => worker.enqueue(`photo${i}`)));
  assert.equal(accepted.filter(({ jobId }) => jobId).length, 10);
  await waitFor(() => worker.imports.length === 1);
  assert.equal(worker.jobs().filter((job) => job.status === "queued").length, 9);
  assert.equal(worker.notices.length, 0);
  assert.equal((await worker.enqueue("photo0")).duplicate, true);

  worker.options.albumId = "second";
  worker.imports[0].reply({ ok: false, error: "network failure" });
  await waitFor(() => worker.imports.length === 2);
  const failed = worker.jobs()[0];
  assert.equal(failed.status, "failed");
  assert.equal(worker.imports[1].payload.albumId, "first");

  await worker.retry(failed.id, true);
  assert.equal(worker.jobs().length, 10);
  const retry = worker.jobs().at(-1);
  assert.equal(retry.id, failed.id);
  assert.equal(retry.retries, 1);
  assert.equal(retry.destination.albumId, "second");

  for (let i = 1; i <= 10; i += 1) {
    await waitFor(() => worker.imports.length === i + 1);
    worker.imports[i].reply({ ok: true, imported: true });
  }
  await waitFor(() => worker.jobs().every((job) => job.status === "success"));
  assert.equal(worker.imports[10].payload.albumId, "second");
  assert.equal(worker.notices.length, 10);
  assert.equal(worker.notices[0].target.documentId, origin.documentId);
});

test("Chrome download ID alone does not mark a job successful", async () => {
  const worker = startWorker([], "download");
  await worker.enqueue("download-a");
  await worker.enqueue("download-b");
  await waitFor(() => worker.jobs()[0].downloadId === 1);
  assert.equal(worker.jobs()[0].status, "saving");
  assert.equal(worker.downloads.get(1).config.saveAs, false);
  assert.equal(worker.downloads.size, 1);
  assert.equal(worker.notices.length, 0);

  worker.completeDownload(1);
  await waitFor(() => worker.jobs()[1].downloadId === 2);
  assert.equal(worker.jobs()[0].status, "success");
  assert.equal(worker.notices.length, 1);
});

test("a new worker preserves pending jobs and flags an unconfirmed Photos import", async () => {
  const original = startWorker();
  await original.enqueue("before-restart");
  await original.enqueue("after-restart");
  await waitFor(() => original.imports.length === 1);

  const restarted = startWorker(original.jobs());
  await waitFor(() => restarted.imports.length === 1);
  assert.equal(restarted.jobs()[0].status, "uncertain");
  assert.match(restarted.imports[0].payload.url, /after-restart/);
  assert.equal(restarted.notices.length, 0);
});
