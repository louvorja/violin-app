// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { HttpQueue } = require("../download/httpQueue.js");
const { publishCollectionFile } = require("../collectionPublication.js");
const roots = [];
const servers = [];
const payload = Buffer.alloc(8000, 7);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-private-download-"));
  roots.push(root);
  const filesDir = path.join(root, "Acervo");
  const workDir = path.join(root, "profile", "temp", "downloads");
  await fs.ensureDir(filesDir);
  return { root, filesDir, workDir, local: path.join(filesDir, "audio.opus") };
}

async function start(baseUrl, folders) {
  const queue = new HttpQueue({ baseUrl, ...folders, concurrency: 1, retryDelaysMs: [] });
  queue.add([{ remote: "/audio.opus", local: "audio.opus" }]);
  let result;
  queue.on("queue-done", (value) => { result = value; });
  await queue.start();
  return result;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe("temporários privados dos downloads do acervo", () => {
  it("mantém parcial e validador no perfil, retoma em outra fila e publica somente bytes completos", async () => {
    const folders = await fixture();
    await fs.writeFile(folders.local, "arquivo anterior");
    let interrupt = true;
    const ranges = [];
    const server = createServer((req, res) => {
      ranges.push(req.headers.range || null);
      const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range || "")?.[1] || 0);
      res.writeHead(offset ? 206 : 200, {
        ETag: '"v1"', "Content-Length": payload.length - offset,
        ...(offset ? { "Content-Range": `bytes ${offset}-${payload.length - 1}/${payload.length}` } : {}),
      });
      if (interrupt) {
        res.write(payload.subarray(0, 2000));
        setTimeout(() => req.socket.destroy(), 10);
      } else res.end(payload.subarray(offset));
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    expect(await start(base, folders)).toEqual({ downloaded: 0, failed: 1 });
    expect(await fs.readdir(folders.filesDir)).toEqual(["audio.opus"]);
    expect(await fs.readFile(folders.local, "utf8")).toBe("arquivo anterior");
    const temporary = await fs.readdir(folders.workDir);
    expect(temporary).toHaveLength(2);
    expect(temporary.some((name) => name.endsWith(".partial"))).toBe(true);
    expect(temporary.some((name) => name.endsWith(".partial.meta"))).toBe(true);

    interrupt = false;
    expect(await start(base, folders)).toEqual({ downloaded: 1, failed: 0 });
    expect(ranges).toEqual([null, "bytes=2000-"]);
    expect(await fs.readFile(folders.local)).toEqual(payload);
    expect(await fs.readdir(folders.workDir)).toEqual([]);
    expect(await fs.readdir(folders.filesDir)).toEqual(["audio.opus"]);
  });

  it("publica entre volumes sem expor o nome final durante a cópia", async () => {
    const folders = await fixture();
    await fs.ensureDir(folders.workDir);
    const temporary = path.join(folders.workDir, "arquivo.partial");
    await fs.writeFile(temporary, payload);
    await fs.writeFile(folders.local, "anterior");
    const queue = new HttpQueue({ ...folders, platform: "linux" });
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (from === temporary) throw Object.assign(new Error("cross device"), { code: "EXDEV" });
      expect(await fs.readFile(folders.local, "utf8")).toBe("anterior");
      expect(await fs.readFile(from)).toEqual(payload);
      return rename(from, to);
    });

    await queue._publish(temporary, folders.local);

    expect(await fs.readFile(folders.local)).toEqual(payload);
    expect(await fs.readdir(folders.filesDir)).toEqual(["audio.opus"]);
    expect(await fs.readdir(folders.workDir)).toEqual([]);
  });

  it("mantém o arquivo anterior e remove a publicação parcial se a cópia entre volumes falhar", async () => {
    const folders = await fixture();
    await fs.ensureDir(folders.workDir);
    const temporary = path.join(folders.workDir, "arquivo.partial");
    await fs.writeFile(temporary, payload);
    await fs.writeFile(folders.local, "anterior");
    const queue = new HttpQueue({ ...folders, platform: "linux" });
    vi.spyOn(fs, "rename").mockRejectedValue(Object.assign(new Error("cross device"), { code: "EXDEV" }));
    vi.spyOn(fs, "copyFile").mockImplementation(async (_from, to) => {
      await fs.writeFile(to, "incompleto");
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });

    await expect(queue._publish(temporary, folders.local)).rejects.toThrow("disk full");

    expect(await fs.readFile(folders.local, "utf8")).toBe("anterior");
    expect(await fs.readdir(folders.filesDir)).toEqual(["audio.opus"]);
    expect(await fs.readFile(temporary)).toEqual(payload);
  });

  it("recusa links na raiz privada ou no arquivo de metadados antes de iniciar a rede", async () => {
    const folders = await fixture();
    await fs.ensureDir(path.dirname(folders.workDir));
    await fs.symlink(folders.filesDir, folders.workDir, "junction");
    const queue = new HttpQueue(folders);
    await expect(queue._prepareWorkFile(path.join(folders.workDir, "a.partial"))).rejects.toThrow("inválida");
    await fs.unlink(folders.workDir);
    await fs.ensureDir(folders.workDir);
    const temporary = path.join(folders.workDir, "a.partial");
    await fs.symlink(folders.local, `${temporary}.meta`);
    await expect(queue._prepareWorkFile(temporary)).rejects.toThrow("inválido");
    expect(await fs.readdir(folders.filesDir)).toEqual([]);
  });

  it("não publica se perde a permissão de escrita durante a cópia entre volumes", async () => {
    const folders = await fixture();
    await fs.ensureDir(folders.workDir);
    const temporary = path.join(folders.workDir, "arquivo.partial");
    await fs.writeFile(temporary, payload);
    await fs.writeFile(folders.local, "anterior");
    let writable = true;
    const copyFile = fs.copyFile.bind(fs);
    const rename = vi.spyOn(fs, "rename").mockRejectedValue(Object.assign(new Error("cross device"), { code: "EXDEV" }));
    vi.spyOn(fs, "copyFile").mockImplementation(async (...args) => {
      await copyFile(...args);
      writable = false;
    });

    await expect(publishCollectionFile(temporary, folders.local, {
      root: folders.filesDir, platform: "linux",
      assertCanPublish: () => { if (!writable) throw new Error("lease-lost"); },
    })).rejects.toThrow("lease-lost");

    expect(rename).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(folders.local, "utf8")).toBe("anterior");
    expect(await fs.readdir(folders.filesDir)).toEqual(["audio.opus"]);
    expect(await fs.readFile(temporary)).toEqual(payload);
  });

  it("informa publicação concluída mesmo se a limpeza do temporário privado falhar", async () => {
    const folders = await fixture();
    await fs.ensureDir(folders.workDir);
    const temporary = path.join(folders.workDir, "arquivo.partial");
    await fs.writeFile(temporary, payload);
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (from === temporary) throw Object.assign(new Error("cross device"), { code: "EXDEV" });
      return rename(from, to);
    });
    const remove = fs.remove.bind(fs);
    vi.spyOn(fs, "remove").mockImplementation(async (file) => {
      if (file === temporary) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return remove(file);
    });

    await expect(publishCollectionFile(temporary, folders.local, {
      root: folders.filesDir, platform: "linux",
    })).resolves.toBeUndefined();

    expect(await fs.readFile(folders.local)).toEqual(payload);
    expect(await fs.readdir(folders.filesDir)).toEqual(["audio.opus"]);
    expect(await fs.readFile(temporary)).toEqual(payload);
  });

  it("no Windows cria a publicação no acervo, sem renomear o arquivo privado mesmo no mesmo volume", async () => {
    const folders = await fixture();
    await fs.ensureDir(folders.workDir);
    const temporary = path.join(folders.workDir, "arquivo.partial");
    await fs.writeFile(temporary, payload, { mode: 0o600 });
    await fs.writeFile(folders.local, "anterior");
    const queue = new HttpQueue({ ...folders, platform: "win32" });
    const rename = fs.rename.bind(fs);
    const open = vi.spyOn(fs, "open");
    const copyFile = vi.spyOn(fs, "copyFile");
    const publish = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      expect(from).not.toBe(temporary);
      expect(path.dirname(from)).toBe(folders.filesDir);
      expect(await fs.readFile(from)).toEqual(payload);
      expect(await fs.readFile(folders.local, "utf8")).toBe("anterior");
      return rename(from, to);
    });

    await queue._publish(temporary, folders.local);

    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\.publishing$/), "wx", 0o666);
    expect(copyFile).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(folders.local)).toEqual(payload);
    expect(await fs.readdir(folders.filesDir)).toEqual(["audio.opus"]);
    expect(await fs.readdir(folders.workDir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("publica leitura0644 e subpastas777 em acervo compartilhado sem ampliar existentes", async () => {
    const folders = await fixture();
    await fs.chmod(folders.filesDir, 0o755);
    await fs.ensureDir(folders.workDir, { mode: 0o700 });
    const temporary = path.join(folders.workDir, "arquivo.partial");
    await fs.writeFile(temporary, payload, { mode: 0o600 });
    const local = path.join(folders.filesDir, "musics", "pt", "a.opus");
    const queue = new HttpQueue({ ...folders, shared: true });

    await queue._prepareDestination(local);
    await queue._publish(temporary, local);

    expect((await fs.stat(local)).mode & 0o777).toBe(0o644);
    expect((await fs.stat(path.dirname(local))).mode & 0o777).toBe(0o777);
    expect((await fs.stat(path.join(folders.filesDir, "musics"))).mode & 0o777).toBe(0o777);
    expect((await fs.stat(folders.filesDir)).mode & 0o777).toBe(0o755);
    expect((await fs.stat(folders.workDir)).mode & 0o777).toBe(0o700);
  });
});
