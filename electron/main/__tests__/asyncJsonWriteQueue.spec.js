// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const {
  atomicWriteJson,
  createAsyncJsonWriteQueue,
} = require("../asyncJsonWriteQueue.js");

const dirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-json-queue-"));
  dirs.push(dir);
  return dir;
}

function withOverrides(overrides) {
  return new Proxy(fs, {
    get(target, property) {
      return Object.prototype.hasOwnProperty.call(overrides, property)
        ? overrides[property]
        : target[property];
    },
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => fs.remove(dir)));
});

describe("createAsyncJsonWriteQueue", () => {
  it("coalesce uma rajada e confirma todas as Promises na ultima revisao", async () => {
    const dir = tempDir();
    let writes = 0;
    const io = withOverrides({
      writeFile: async (...args) => {
        writes += 1;
        return fs.writeFile(...args);
      },
    });
    const queue = createAsyncJsonWriteQueue({
      name: "testStore",
      resolveFile: (key) => path.join(dir, `${key}.json`),
      debounceMs: 60_000,
      io,
    });

    const first = queue.enqueueWrite("prefs", '{"revision":1}\n');
    const second = queue.enqueueWrite("prefs", '{"revision":2}\n');
    const last = queue.enqueueWrite("prefs", '{"revision":3}\n');

    expect(queue.peek("prefs").revision).toBe(3);
    await queue.flush();

    await expect(Promise.all([first, second, last])).resolves.toEqual([
      { ok: true, revision: 3 },
      { ok: true, revision: 3 },
      { ok: true, revision: 3 },
    ]);
    expect(writes).toBe(1);
    expect(await fs.readJson(path.join(dir, "prefs.json"))).toEqual({ revision: 3 });
    expect(queue.peek("prefs")).toBeNull();
  });

  it("mantem a ordem das revisoes sobreviventes entre chaves", async () => {
    const dir = tempDir();
    const order = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const io = withOverrides({
      writeFile: async (file, ...args) => {
        order.push(path.basename(file).replace(".json.tmp", ""));
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        try {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return await fs.writeFile(file, ...args);
        } finally {
          activeWrites -= 1;
        }
      },
    });
    const queue = createAsyncJsonWriteQueue({
      name: "testStore",
      resolveFile: (key) => path.join(dir, `${key}.json`),
      debounceMs: 60_000,
      io,
    });

    const a1 = queue.enqueueWrite("a", "1\n");
    const b1 = queue.enqueueWrite("b", "2\n");
    const a2 = queue.enqueueWrite("a", "3\n");
    await queue.flush();
    await Promise.all([a1, b1, a2]);

    // A1 foi substituida. As operacoes efetivas seguem B1 (rev. 2), A2 (rev. 3).
    expect(order).toEqual(["b", "a"]);
    expect(maxActiveWrites).toBe(1);
    expect(await fs.readJson(path.join(dir, "a.json"))).toBe(3);
    expect(await fs.readJson(path.join(dir, "b.json"))).toBe(2);
  });

  it("flush ignora o debounce e deixa o snapshot duravel", async () => {
    const dir = tempDir();
    const file = path.join(dir, "docs.json");
    const queue = createAsyncJsonWriteQueue({
      name: "testStore",
      resolveFile: () => file,
      debounceMs: 60_000,
    });

    const write = queue.enqueueWrite("docs", '[{"id":"final"}]\n');
    expect(await fs.pathExists(file)).toBe(false);

    await expect(queue.flush()).resolves.toMatchObject({ ok: true, revision: 1 });
    await expect(write).resolves.toEqual({ ok: true, revision: 1 });
    expect(await fs.readJson(file)).toEqual([{ id: "final" }]);
  });

  it("propaga falha, preserva o arquivo anterior e limpa o temp", async () => {
    const dir = tempDir();
    const file = path.join(dir, "prefs.json");
    await fs.writeJson(file, { old: true });
    const denied = Object.assign(new Error("arquivo bloqueado"), { code: "EPERM" });
    const io = withOverrides({
      rename: async () => {
        throw denied;
      },
    });
    const queue = createAsyncJsonWriteQueue({
      name: "testStore",
      resolveFile: () => file,
      debounceMs: 60_000,
      io,
    });

    const write = queue.enqueueWrite("prefs", '{"new":true}\n');
    const flush = queue.flush();

    await expect(write).rejects.toThrow("arquivo bloqueado");
    await expect(flush).rejects.toThrow("gravacao(oes) pendente(s)");
    expect(await fs.readJson(file)).toEqual({ old: true });
    expect(await fs.pathExists(`${file}.tmp`)).toBe(false);
    expect(await fs.pathExists(`${file}.bak`)).toBe(false);
  });
});

describe("atomicWriteJson", () => {
  it("mantem o destino antigo ate o rename e usa fallback Windows sem sobras", async () => {
    const dir = tempDir();
    const file = path.join(dir, "prefs.json");
    await fs.writeJson(file, { revision: 1 });
    let sawOldDuringTempWrite = false;
    let refusedReplace = false;
    const io = withOverrides({
      writeFile: async (...args) => {
        await fs.writeFile(...args);
        sawOldDuringTempWrite = (await fs.readJson(file)).revision === 1;
      },
      rename: async (from, to) => {
        if (!refusedReplace && from === `${file}.tmp` && to === file) {
          refusedReplace = true;
          throw Object.assign(new Error("Windows recusou replace"), { code: "EPERM" });
        }
        return fs.rename(from, to);
      },
    });

    await atomicWriteJson({ io, file, contents: '{"revision":2}\n' });

    expect(sawOldDuringTempWrite).toBe(true);
    expect(refusedReplace).toBe(true);
    expect(await fs.readJson(file)).toEqual({ revision: 2 });
    expect(await fs.pathExists(`${file}.tmp`)).toBe(false);
    expect(await fs.pathExists(`${file}.bak`)).toBe(false);
  });

  it("limpa um temp parcialmente escrito quando writeFile falha", async () => {
    const dir = tempDir();
    const file = path.join(dir, "prefs.json");
    const io = withOverrides({
      writeFile: async (...args) => {
        await fs.writeFile(...args);
        throw Object.assign(new Error("disco cheio"), { code: "ENOSPC" });
      },
    });

    await expect(
      atomicWriteJson({ io, file, contents: '{"revision":2}\n' })
    ).rejects.toThrow("disco cheio");
    expect(await fs.pathExists(file)).toBe(false);
    expect(await fs.pathExists(`${file}.tmp`)).toBe(false);
  });
});
