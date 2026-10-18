"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { initialize } = require("./storageLayout.js");
const { createWorkerAcquire } = require("./storageCollectionLeaseBridge.cjs");

function assertParentAlive() {
  try { process.kill(workerData.ownedBootstrapPid, 0); }
  catch (cause) {
    throw new Error("O aplicativo foi encerrado. A migração pode ser retomada na próxima abertura.", { cause });
  }
}

try {
  assertParentAlive();
  let sentAt = 0, phase = "";
  initialize({
    ...workerData,
    acquireCollection: createWorkerAcquire(parentPort, { parentPid: workerData.ownedBootstrapPid }),
    onProgress(progress) {
      assertParentAlive();
      const now = Date.now();
      if (progress.phase === phase && now - sentAt < 80) return;
      sentAt = now;
      phase = progress.phase;
      parentPort.postMessage({ type: "progress", progress });
    },
  });
  parentPort.postMessage({ type: "complete" });
} catch (error) {
  parentPort.postMessage({ type: "error", message: error.message });
}
