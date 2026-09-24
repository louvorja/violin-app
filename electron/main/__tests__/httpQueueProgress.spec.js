// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { HttpQueue } = require("../download/httpQueue.js");

const temporaryDirs = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HttpQueue — coalescência de progresso", () => {
  it("emite apenas a amostra mais recente de cada arquivo por intervalo", async () => {
    vi.useFakeTimers();
    const queue = new HttpQueue({
      baseUrl: "http://127.0.0.1",
      progressIntervalMs: 100,
    });
    const progress = [];
    queue.on("progress", (payload) => progress.push(payload));

    queue._queueProgress(1, { file: "a", bytes: 1 });
    queue._queueProgress(1, { file: "a", bytes: 2 });
    queue._queueProgress(2, { file: "b", bytes: 3 });

    expect(progress).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(progress).toEqual([
      { file: "a", bytes: 2 },
      { file: "b", bytes: 3 },
    ]);
    expect(queue._pendingProgress.size).toBe(0);
    expect(queue._progressTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("descarta amostras intermediárias e limpa o timer ao cancelar", async () => {
    vi.useFakeTimers();
    const queue = new HttpQueue({
      baseUrl: "http://127.0.0.1",
      progressIntervalMs: 100,
    });
    const progress = vi.fn();
    queue.on("progress", progress);

    queue._queueProgress(1, { file: "a", bytes: 10 });
    expect(vi.getTimerCount()).toBe(1);

    queue.cancel();
    await vi.runAllTimersAsync();

    expect(progress).not.toHaveBeenCalled();
    expect(queue._pendingProgress.size).toBe(0);
    expect(queue._progressTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("entrega o progresso final antes dos eventos terminais da fila", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "louvorja-http-queue-"));
    temporaryDirs.push(root);
    const local = path.join(root, "media", "track.bin");
    const queue = new HttpQueue({
      baseUrl: "http://127.0.0.1",
      concurrency: 1,
      progressIntervalMs: 60_000,
    });
    queue.add([{ remote: "/track.bin", local }]);

    queue._downloadOne = async (_url, tmp, onProgress) => {
      await writeFile(tmp, "ok");
      for (let bytes = 1; bytes <= 50; bytes++) onProgress(bytes, 50);
    };

    const seen = [];
    queue.on("progress", (payload) => seen.push(["progress", payload.bytes]));
    queue.on("file-done", () => seen.push(["file-done"]));
    queue.on("queue-done", () => seen.push(["queue-done"]));

    await queue.start();

    expect(seen).toEqual([
      ["progress", 50],
      ["file-done"],
      ["queue-done"],
    ]);
    expect(await readFile(local, "utf8")).toBe("ok");
    expect(queue._pendingProgress.size).toBe(0);
    expect(queue._progressTimer).toBeNull();
  });
});
