// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { UtilityQueue } = require("../download/utilityQueue.js");
const { runWorker } = require("../download/utilityWorker.cjs");
const { HttpQueue } = require("../download/httpQueue.js");
const dirs = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fixture() {
  const child = new EventEmitter();
  child.postMessage = vi.fn();
  child.kill = vi.fn();
  const root = path.join(os.tmpdir(), "utility-test");
  const queue = new UtilityQueue({ filesDir: root, baseUrl: "https://example.test", fork: () => child });
  queue.add([{ remote: "/a", local: "a" }]);
  const emit = (type, data, jobId = queue.jobId) => child.emit("message", { version: 1, jobId, type, data });
  return { queue, child, emit, root };
}

describe("download utility process", () => {
  it("uses a private start message and only forwards validated current-job events", async () => {
    const { queue, child, emit, root } = fixture();
    const progress = vi.fn();
    const done = vi.fn();
    queue.on("progress", progress);
    queue.on("queue-done", done);
    const completion = queue.start();
    expect(child.postMessage).not.toHaveBeenCalled();
    emit("ready");
    expect(child.postMessage.mock.calls[0][0].type).toBe("start");
    emit("started");
    emit("progress", { file: "/a", current: 1, total: 1, bytes: 5, totalBytes: 10 }, "old-job");
    emit("progress", { file: "/a", current: 1, total: 1, bytes: Infinity, totalBytes: 10 });
    expect(progress).not.toHaveBeenCalled();
    emit("progress", { file: "/a", current: 1, total: 1, bytes: 5, totalBytes: 10 });
    expect(progress).toHaveBeenCalledOnce();
    emit("file-done", { file: "/a", localPath: path.join(root, "a") });
    emit("queue-done", { downloaded: 1, failed: 0 });
    child.emit("exit", 0);
    await completion;
    expect(done).toHaveBeenCalledExactlyOnceWith({ downloaded: 1, failed: 0 });
    expect(queue.running).toBe(false);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("fails closed on startup timeout and resolves completion", async () => {
    vi.useFakeTimers();
    const { queue, child } = fixture();
    const done = vi.fn();
    queue.on("queue-done", done);
    const completion = queue.start();
    await vi.advanceTimersByTimeAsync(10000);
    await completion;
    expect(done).toHaveBeenCalledWith({ downloaded: 0, failed: 1, error: "download_worker_start_timeout" });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("reports a worker crash once and allows a fresh adapter", async () => {
    const { queue, child } = fixture();
    const done = vi.fn();
    queue.on("queue-done", done);
    const completion = queue.start();
    child.emit("exit", 1);
    child.emit("error", new Error("secret details"));
    await completion;
    expect(done).toHaveBeenCalledExactlyOnceWith({ downloaded: 0, failed: 1, error: "download_worker_exited" });
    expect(fixture().queue.running).toBe(false);
  });

  it("retains the cancellation deadline when started arrives late", async () => {
    vi.useFakeTimers();
    const { queue, emit, child } = fixture();
    const cancelled = vi.fn();
    queue.on("queue-cancelled", cancelled);
    queue.start();
    queue.pause();
    const completion = queue.shutdown();
    emit("ready");
    emit("started");
    await vi.advanceTimersByTimeAsync(2000);
    await completion;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("forwards explicit pause/resume while running", async () => {
    const { queue, emit, child } = fixture();
    const completion = queue.start();
    emit("ready");
    emit("started");
    queue.pause();
    queue.resume();
    expect(child.postMessage.mock.calls.map(([message]) => message.type)).toEqual(["start", "pause", "resume"]);
    emit("queue-done", { downloaded: 0, failed: 1 });
    await completion;
  });

  it("rejects malformed worker results", async () => {
    const { queue, emit } = fixture();
    const done = vi.fn();
    queue.on("queue-done", done);
    const completion = queue.start();
    emit("queue-done", { downloaded: 99, failed: 0 });
    await completion;
    expect(done.mock.calls[0][0].error).toBe("download_worker_invalid_result");
  });

  it("worker rejects a path escaping its trusted root before starting requests", () => {
    const port = new EventEmitter();
    port.postMessage = vi.fn();
    runWorker(port);
    port.emit("message", { data: { version: 1, jobId: "job", type: "start", data: {
      filesDir: os.tmpdir(), baseUrl: "https://example.test", files: [{ remote: "/a", local: "../a" }],
    } } });
    expect(port.postMessage.mock.calls.map(([message]) => message.type)).toEqual(["ready", "fatal"]);
  });

  it("rejects symlinked destination parents and temporary files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "download-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "download-outside-"));
    dirs.push(root, outside);
    await symlink(outside, path.join(root, "escape"), "junction");
    const queue = new HttpQueue({ filesDir: root });
    await expect(queue._prepareDestination(path.join(root, "escape", "nested", "a"))).rejects.toThrow("inválido");
    await expect(queue._assertDestination(path.join(root, "escape", "a"), path.join(root, "escape", "a.tmp"))).rejects.toThrow("fora");
    await mkdir(path.join(root, "safe"));
    await symlink(outside, path.join(root, "safe", "a.tmp"), "junction");
    await expect(queue._assertDestination(path.join(root, "safe", "a"), path.join(root, "safe", "a.tmp"))).rejects.toThrow("simbólico");
  });
});
