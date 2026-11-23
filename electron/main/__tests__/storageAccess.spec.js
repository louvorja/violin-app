// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const access = require("../storageAccess.js");
const TIMING = { ...access.TIMING };
const HOST = crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16);
let root, media, videos;
/** O batimento e a nova tentativa fazem I/O de verdade: os timers são falsos, o disco não. */
async function until(check) {
  // Pelo relógio de verdade: num disco lento a resposta leva mais que um punhado de voltas do loop.
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("A condição não foi atingida.");
}
const fakeClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
/** Uma batida completa das duas travas: o timer seguinte só existe depois de o disco responder. */
async function beat() {
  const timers = vi.getTimerCount();
  vi.advanceTimersByTime(10001);
  await until(() => vi.getTimerCount() === timers);
}
const lockOf = (dir) => path.join(dir, ".louvorja-writer.lock");
const ownerOf = (dir) => path.join(dir, ".louvorja-writer.json");
/** Trava deixada por outro processo, com o registro que a versão atual grava. */
function leftover(dir, owner = {}) {
  fs.mkdirSync(lockOf(dir));
  const { dev, ino, birthtimeMs } = fs.lstatSync(lockOf(dir));
  fs.writeJsonSync(ownerOf(dir), {
    version: 1, host: HOST, pid: deadPid(), instance: "outra", lock: { dev, ino, birthtimeMs }, ...owner,
  });
}
function deadPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-access-"));
  media = path.join(root, "media"); videos = path.join(root, "videos");
  fs.ensureDirSync(media); fs.ensureDirSync(videos);
});
afterEach(() => {
  access.release(); Object.assign(access.TIMING, TIMING);
  vi.restoreAllMocks(); vi.useRealTimers(); fs.removeSync(root);
});
const layout = (extras = {}) => ({ mediaDir: media, videosDir: videos, ...extras });

describe("permissão de escrita e metadado compartilhado", () => {
  it("preserva kind e grava metadado legível por outras contas, mantendo manutenção desativada", () => {
    access.initialize(layout({ mediaShared: true, videosShared: true }));
    for (const [kind, dir] of [["media", media], ["videos", videos]]) {
      const file = path.join(dir, ".louvorja-collection.json");
      expect(fs.readJsonSync(file)).toEqual({ version: 1, kind, shared: true });
      if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o644);
      expect(access.canWrite(kind)).toBe(true);
      expect(access.canMaintain(kind)).toBe(false);
    }
  });

  it("não volta a pessoal quando outra conta marca shared e atualiza o status do escritor", () => {
    access.initialize(layout());
    expect(access.canMaintain("media")).toBe(true);
    access.markShared(media, "media");
    expect(access.canMaintain("media")).toBe(false);
    expect(access.status().media.shared).toBe(true);
    access.initialize(layout());
    expect(access.readMarker(media, "media").shared).toBe(true);
    expect(access.canMaintain("media")).toBe(false);
  });

  it("permite consultar um acervo já compartilhado sem tentar escrever o marcador", () => {
    fs.writeJsonSync(path.join(media, ".louvorja-collection.json"), { version: 1, kind: "media", shared: true });
    const write = vi.spyOn(fs, "writeJsonSync").mockImplementation(() => { throw new Error("read only"); });
    expect(() => access.markShared(media, "media")).not.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it("não obtém permissão de escrita com marcador inválido ou de outro tipo", () => {
    fs.writeJsonSync(path.join(media, ".louvorja-collection.json"), { version: 1, kind: "videos", shared: true });
    access.initialize(layout());
    expect(access.canWrite("media")).toBe(false);
    expect(access.canMaintain("media")).toBe(false);
    expect(access.canWrite("videos")).toBe(true);
  });

  it("nega escrita imediatamente quando a raiz desaparece sem recriá-la", () => {
    access.initialize(layout());
    expect(access.canWrite("media")).toBe(true);
    fs.removeSync(media);
    expect(access.canWrite("media")).toBe(false);
    expect(access.canMaintain("media")).toBe(false);
    expect(() => access.assertWritable("media")).toThrow(/somente para leitura/);
    expect(access.status().media).toMatchObject({ writable: false, reason: "unavailable" });
    expect(fs.existsSync(media)).toBe(false);
    expect(access.canWrite("videos")).toBe(true);
  });

  it("não confunde outra raiz no mesmo caminho nem remove o lease de outro escritor", () => {
    access.initialize(layout());
    fs.renameSync(media, `${media}-original`);
    fs.ensureDirSync(path.join(media, ".louvorja-writer.lock"));
    expect(access.canWrite("media")).toBe(false);
    access.release();
    expect(fs.lstatSync(path.join(media, ".louvorja-writer.lock")).isDirectory()).toBe(true);
  });

  it("nega escrita quando somente o lease foi substituído e preserva a nova proteção", () => {
    access.initialize(layout());
    const lock = path.join(media, ".louvorja-writer.lock");
    fs.renameSync(lock, path.join(media, ".old-lock"));
    fs.mkdirSync(lock);
    expect(access.canWrite("media")).toBe(false);
    access.release();
    expect(fs.lstatSync(lock).isDirectory()).toBe(true);
  });

  it("o iCloud reescrever o horário da trava não derruba o escritor, e ela continua sendo renovada", async () => {
    fakeClock();
    access.initialize(layout());
    const lock = lockOf(media);
    // Documentos no iCloud Drive: o horário volta em segundos inteiros, com o relógio do próprio
    // iCloud — depois do nascimento da pasta ou, no mesmo segundo, antes dele.
    for (const rewritten of [Math.ceil(Date.now() / 1000) + 1, Math.floor(Date.now() / 1000) - 3]) {
      fs.utimesSync(lock, rewritten, rewritten);
      await beat();
      expect(fs.statSync(lock).mtimeMs).not.toBe(rewritten * 1000);
      expect(access.canWrite("media")).toBe(true);
    }
    access.release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("mantém heartbeat do escritor após gravar metadados com um lease independente", async () => {
    fakeClock();
    access.initialize(layout());
    access.markShared(media, "media");
    for (const dir of [media, videos]) fs.utimesSync(lockOf(dir), 1, 1);
    await beat();
    for (const dir of [media, videos]) expect(fs.statSync(lockOf(dir)).mtimeMs).not.toBe(1000);
    expect(access.canWrite("media")).toBe(true);
    expect(access.canWrite("videos")).toBe(true);
    expect(access.canMaintain("media")).toBe(false);
  });
});

describe("trava de escrita", () => {
  it("renova a trava sem chamada síncrona ao disco", async () => {
    fakeClock();
    access.initialize(layout());
    fs.utimesSync(lockOf(media), 1, 1);
    // Cada chamada síncrona aqui para o processo principal pelo tempo que o disco levar.
    const sync = ["statSync", "lstatSync", "utimesSync", "readFileSync", "mkdirSync", "rmdirSync"]
      .map((name) => vi.spyOn(fs, name));
    await beat();
    const calls = sync.map((spy) => spy.mock.calls.length);
    vi.restoreAllMocks();
    expect(fs.statSync(lockOf(media)).mtimeMs).not.toBe(1000);
    expect(calls).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("retoma na abertura a trava deixada por um processo deste computador que já morreu", () => {
    leftover(media);
    access.initialize(layout());
    expect(access.status().media).toMatchObject({ writable: true, reason: null });
    expect(fs.readJsonSync(ownerOf(media)).pid).toBe(process.pid);
    access.release();
    expect(fs.existsSync(lockOf(media))).toBe(false);
    expect(fs.existsSync(ownerOf(media))).toBe(false);
  });

  it("respeita a trava de um processo vivo, de outro computador ou sem registro", () => {
    const cases = [
      () => leftover(media, { pid: process.ppid }),
      () => leftover(media, { host: "outro-computador" }),
      () => fs.mkdirSync(lockOf(media)),
      // Versão antiga retomou a trava: o registro ao lado é do dono anterior.
      () => { leftover(media); fs.rmdirSync(lockOf(media)); fs.mkdirSync(lockOf(media)); },
      () => { fs.mkdirSync(lockOf(media)); fs.writeFileSync(ownerOf(media), "{"); },
    ];
    for (const prepare of cases) {
      prepare();
      access.initialize(layout());
      expect(access.status().media).toMatchObject({ writable: false, reason: "in-use" });
      expect(access.canWrite("videos")).toBe(true);
      access.release();
      expect(fs.lstatSync(lockOf(media)).isDirectory()).toBe(true);
      fs.rmdirSync(lockOf(media));
      fs.removeSync(ownerOf(media));
    }
  });

  it("não toma a própria trava quando o sistema reaproveita o número do processo", () => {
    access.initialize(layout());
    expect(() => access.acquire(media)).toThrow(expect.objectContaining({ code: "ELOCKED" }));
    expect(access.canWrite("media")).toBe(true);
    access.release();
    // Mesmo número, outro processo: o anterior morreu.
    leftover(media, { pid: process.pid });
    access.initialize(layout());
    expect(access.canWrite("media")).toBe(true);
  });

  it("volta a gravar na mesma sessão quando a trava alheia é abandonada ou solta", async () => {
    fakeClock();
    fs.mkdirSync(lockOf(media));
    fs.mkdirSync(lockOf(videos));
    access.initialize(layout());
    expect(access.status()).toMatchObject({ media: { writable: false, reason: "in-use" }, videos: { writable: false, reason: "in-use" } });
    // Ainda em uso: nada muda.
    vi.advanceTimersByTime(15001);
    await until(() => vi.getTimerCount() === 1);
    expect(access.canWrite("media")).toBe(false);
    // O outro escritor saiu de um; morreu sem avisar no outro (trava de versão antiga, sem registro).
    fs.rmdirSync(lockOf(videos));
    const old = (Date.now() - 121000) / 1000;
    fs.utimesSync(lockOf(media), old, old);
    vi.advanceTimersByTime(15001);
    await until(() => access.canWrite("media") && access.canWrite("videos"));
    expect(access.status()).toMatchObject({ media: { writable: true, reason: null }, videos: { writable: true, reason: null } });
    expect(fs.readJsonSync(ownerOf(media)).pid).toBe(process.pid);
  });

  it("perder a trava deixa a sessão somente leitura e ela se recupera, sem encerrar o app", async () => {
    fakeClock();
    access.initialize(layout());
    // Disco desconectado e reconectado: a pasta volta sem a trava.
    fs.rmdirSync(lockOf(media));
    // A batida percebe sozinha, sem ninguém tentar gravar: sobram a de vídeos e a nova tentativa.
    await beat();
    expect(access.status().media).toMatchObject({ writable: false, reason: "unavailable" });
    vi.advanceTimersByTime(15001);
    await until(() => access.canWrite("media"));
    expect(fs.lstatSync(lockOf(media)).isDirectory()).toBe(true);
  });

  it("não insiste numa pasta que não muda sozinha", () => {
    fakeClock();
    fs.writeJsonSync(path.join(media, ".louvorja-collection.json"), { version: 1, kind: "videos", shared: true });
    access.initialize(layout());
    expect(access.status().media).toMatchObject({ writable: false, reason: "unavailable" });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("solta as travas quando o processo sai sem passar por release", () => {
    const before = process.listenerCount("exit");
    access.initialize(layout());
    expect(process.listenerCount("exit")).toBe(before + 1);
    process.listeners("exit").at(-1)();
    expect(fs.existsSync(lockOf(media))).toBe(false);
    expect(fs.existsSync(lockOf(videos))).toBe(false);
    expect(process.listenerCount("exit")).toBe(before);
  });
});
