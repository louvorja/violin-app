// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-private-autocache-")));
const media = path.join(root, "Acervo");
const profile = path.join(root, "profile");
const work = path.join(profile, "temp", "downloads");
let handleRequest, remoteResponse, writable = true;
function stub(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub("electron", { protocol: { handle: (_scheme, handler) => { handleRequest = handler; } },
  app: { getAppPath: () => root }, net: { fetch: async () => remoteResponse } });
stub("../paths.js", { filesDir: () => media, dataDir: () => profile });
stub("../storageAccess.js", { canWrite: () => writable, status: () => ({ media: { shared: true, writable } }) });
stub("../onlineVideo/index.js", { fileFor: () => null });
const protocol = require("../protocol.js");

beforeAll(async () => {
  await fs.ensureDir(media);
  protocol.setRemoteConfig({ filesUrl: "https://example.invalid" });
  protocol.handle();
});
afterAll(async () => { await fs.remove(root); });

describe("auto-cache do protocolo com trabalho privado", () => {
  it("grava streaming no perfil e publica bytes completos com acesso ao acervo compartilhado", async () => {
    let stream;
    remoteResponse = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    const response = await handleRequest(new Request("louvorja://files/musics/pt/a.opus"));
    const playback = response.text();
    stream.enqueue(Buffer.from("primeira parte"));
    await expect.poll(async () => (await fs.readdir(work).catch(() => [])).length).toBe(1);
    const target = path.join(media, "musics", "pt", "a.opus");
    expect(await fs.pathExists(target)).toBe(false);
    expect(await fs.readdir(path.dirname(target))).toEqual([]);

    stream.enqueue(Buffer.from("; final"));
    stream.close();
    expect(await playback).toBe("primeira parte; final");
    await expect.poll(() => fs.readFile(target, "utf8").catch(() => null)).toBe("primeira parte; final");
    await expect.poll(() => fs.readdir(work)).toEqual([]);
    if (process.platform !== "win32") {
      expect((await fs.stat(target)).mode & 0o777).toBe(0o644);
      expect((await fs.stat(path.dirname(target))).mode & 0o777).toBe(0o777);
      expect((await fs.stat(work)).mode & 0o777).toBe(0o700);
    }
  });

  it("não publica quando a permissão de escritor é perdida durante o streaming", async () => {
    let stream;
    remoteResponse = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    const response = await handleRequest(new Request("louvorja://files/musics/pt/b.opus"));
    const playback = response.text();
    stream.enqueue(Buffer.from("conteúdo"));
    await expect.poll(async () => (await fs.readdir(work)).length).toBe(1);
    writable = false;
    stream.close();
    expect(await playback).toBe("conteúdo");
    await expect.poll(() => fs.readdir(work)).toEqual([]);
    expect(await fs.pathExists(path.join(media, "musics", "pt", "b.opus"))).toBe(false);
  });
});
