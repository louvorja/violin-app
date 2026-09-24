// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { HttpQueue } = require("../download/httpQueue.js");
const fsExtra = require("fs-extra");
const temporaryDirs = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function queueWithFiles(names) {
  const queue = new HttpQueue({ baseUrl: "http://127.0.0.1", concurrency: 1 });
  queue.add(names.map((name) => ({ remote: name, local: path.join(os.tmpdir(), `lj-admission-${name}`) })));
  return queue;
}

describe("HttpQueue background admission", () => {
  it("holds new requests until admission is unblocked", async () => {
    const queue = queueWithFiles(["a", "b"]);
    const started = [];
    queue._processItem = vi.fn(async (item) => {
      started.push(item.remote);
      return { ok: true };
    });
    queue.setAdmissionBlocked(true);

    const done = queue.start();
    await Promise.resolve();
    expect(started).toEqual([]);
    expect(queue._resumeWaiters).toHaveLength(1);

    queue.setAdmissionBlocked(false);
    await done;
    expect(started).toEqual(["a", "b"]);
    expect(queue._resumeWaiters).toHaveLength(0);
  });

  it("lets an active file finish but waits before starting the next", async () => {
    const queue = queueWithFiles(["a", "b"]);
    const started = [];
    let finishFirst;
    queue._processItem = vi.fn(async (item) => {
      started.push(item.remote);
      if (item.remote === "a") await new Promise((resolve) => { finishFirst = resolve; });
      return { ok: true };
    });

    const done = queue.start();
    await vi.waitFor(() => expect(started).toEqual(["a"]));
    queue.setAdmissionBlocked(true);
    finishFirst();
    await vi.waitFor(() => expect(queue._resumeWaiters).toHaveLength(1));
    expect(started).toEqual(["a"]);

    queue.setAdmissionBlocked(false);
    await done;
    expect(started).toEqual(["a", "b"]);
  });

  it("rechecks admission after asynchronous directory preparation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lj-admission-"));
    temporaryDirs.push(root);
    const queue = new HttpQueue({ baseUrl: "http://127.0.0.1", concurrency: 1 });
    queue.add([{ remote: "a", local: path.join(root, "a.bin") }]);
    let preparationStarted;
    let finishPreparation;
    const entered = new Promise((resolve) => { preparationStarted = resolve; });
    const preparing = new Promise((resolve) => { finishPreparation = resolve; });
    const ensureDir = fsExtra.ensureDir;
    vi.spyOn(fsExtra, "ensureDir").mockImplementation(async (dir) => {
      preparationStarted();
      await preparing;
      return ensureDir(dir);
    });
    queue._downloadOne = vi.fn(async (_url, tmp) => writeFile(tmp, "ok"));

    const done = queue.start();
    await entered;
    queue.setAdmissionBlocked(true);
    finishPreparation();
    await vi.waitFor(() => expect(queue._resumeWaiters).toHaveLength(1));
    expect(queue._downloadOne).not.toHaveBeenCalled();

    queue.setAdmissionBlocked(false);
    await done;
    expect(queue._downloadOne).toHaveBeenCalledOnce();
  });

  it("keeps manual pause independent from admission", async () => {
    const queue = queueWithFiles(["a"]);
    const process = vi.fn(async () => ({ ok: true }));
    queue._processItem = process;
    const done = queue.start();
    queue.pause();
    queue.setAdmissionBlocked(true);
    queue.setAdmissionBlocked(false);
    await Promise.resolve();
    expect(process).not.toHaveBeenCalled();
    expect(queue.paused).toBe(true);

    queue.resume();
    await done;
    expect(process).toHaveBeenCalledOnce();

    const second = queueWithFiles(["b"]);
    second._processItem = process;
    second.setAdmissionBlocked(true);
    const secondDone = second.start();
    second.pause();
    second.resume();
    await Promise.resolve();
    expect(process).toHaveBeenCalledOnce();
    second.setAdmissionBlocked(false);
    await secondDone;
    expect(process).toHaveBeenCalledTimes(2);
  });

  it("cancel while blocked releases waiters and emits queue-cancelled", async () => {
    const queue = queueWithFiles(["a"]);
    queue._processItem = vi.fn(async () => ({ ok: true }));
    const cancelled = vi.fn();
    queue.on("queue-cancelled", cancelled);
    queue.setAdmissionBlocked(true);
    const done = queue.start();
    await Promise.resolve();
    expect(queue._resumeWaiters).toHaveLength(1);

    queue.cancel();
    await done;
    expect(queue._processItem).not.toHaveBeenCalled();
    expect(queue._resumeWaiters).toHaveLength(0);
    expect(queue.running).toBe(false);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(queue.admissionBlocked).toBe(true);
  });
});
