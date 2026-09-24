"use strict";
const { HttpQueue } = require("./httpQueue.js");
const { validateDownloadEntries } = require("./requestValidation.js");

/** The port is injected in tests; production uses Electron's private parent port. */
function runWorker(port) {
  let queue = null;
  let jobId = null;
  let terminal = false;
  const send = (type, data) => port.postMessage({ version: 1, jobId, type, data });
  const finish = (type, data) => {
    if (terminal) return;
    terminal = true;
    send(type, data);
  };
  port.on("message", ({ data: message }) => {
    if (!message || message.version !== 1 || terminal) return;
    if (message.type === "start" && !queue && !jobId) {
      if (typeof message.jobId !== "string" || message.jobId.length > 64) return;
      jobId = message.jobId;
      try {
        const { files, filesDir, baseUrl, apiToken, allowedRemoteOrigins } = message.data || {};
        const validated = validateDownloadEntries(files, { filesDir, filesBaseUrl: baseUrl, allowedRemoteOrigins });
        queue = new HttpQueue({ baseUrl, apiToken, filesDir });
        queue.add(validated);
        for (const type of ["progress", "file-done", "file-error"]) queue.on(type, (data) => send(type, data));
        queue.on("queue-done", (data) => finish("queue-done", data));
        queue.on("queue-cancelled", () => finish("queue-cancelled"));
        send("started");
        void queue.start().catch(() => finish("fatal", { code: "download_worker_failed" }));
      } catch {
        finish("fatal", { code: "download_worker_invalid_start" });
      }
      return;
    }
    if (message.jobId !== jobId || !queue) return;
    if (message.type === "pause") queue.pause();
    if (message.type === "resume") queue.resume();
    if (message.type === "cancel" || message.type === "shutdown") queue.cancel();
  });
  send("ready");
}

if (process.parentPort) runWorker(process.parentPort);
module.exports = { runWorker };
