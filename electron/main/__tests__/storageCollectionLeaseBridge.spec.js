// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
const require = createRequire(import.meta.url);
const { createHostLeases } = require("../storageCollectionLeaseBridge.cjs");

describe("leases de cópia mantidos fora do worker síncrono", () => {
  it("mantém o heartbeat responsivo enquanto o worker faz trabalho bloqueante", async () => {
    let ticks = 0, released = false, interval;
    const host = createHostLeases(() => {
      interval = setInterval(() => ticks++, 5);
      return () => { clearInterval(interval); released = true; };
    });
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const acquire = require(workerData.module).createWorkerAcquire(parentPort);
      const release = acquire('/synthetic-root');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      release();
    `, { eval: true, workerData: { module: require.resolve("../storageCollectionLeaseBridge.cjs") } });
    try {
      await new Promise((resolve, reject) => {
        worker.on("message", host.handle);
        worker.once("error", reject);
        worker.once("exit", (code) => code ? reject(new Error(`worker exit ${code}`)) : resolve());
      });
      expect(ticks).toBeGreaterThan(5);
      expect(released).toBe(true);
    } finally { host.releaseAll(); await worker.terminate(); }
  });

  it("responde à falha de lock sem deixar o worker esperando", () => {
    const signal = new SharedArrayBuffer(4);
    const host = createHostLeases(() => { throw new Error("busy"); });
    expect(host.handle({ type: "collection-lease", operation: "acquire", id: 1, root: "/synthetic", signal })).toBe(true);
    expect(Atomics.load(new Int32Array(signal), 0)).toBe(2);
  });
});
