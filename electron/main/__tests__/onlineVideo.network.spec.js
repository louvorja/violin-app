// @vitest-environment node
/**
 * Ponta a ponta contra a internet de verdade: baixa o yt-dlp e o ffmpeg do
 * GitHub (conferindo o SHA-256 fixado no código), depois baixa vídeos do
 * YouTube. É lento e depende de rede, então só roda com LJ_NET_TESTS=1.
 *
 *   LJ_NET_TESTS=1 npx vitest run electron/main/__tests__/onlineVideo.network.spec.js
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";
import os from "os";
import path from "path";
import fs from "fs";
import { execFileSync, execFile } from "child_process";

const require = createRequire(import.meta.url);
const { createTools } = require("../onlineVideo/tools.js");
const { createManager } = require("../onlineVideo/manager.js");

const enabled = process.env.LJ_NET_TESTS === "1" && process.platform !== "win32";

/** "Me at the zoo": 19 s, a menor coisa pública que o YouTube serve. */
const SHORT = "jNQXAC9IVRw";
/** Clipe de 4 min do catálogo do app, com 1080p em H.264. */
const LONG = "T8YHfGrk3ok";

function streamsOf(file, ffmpeg) {
  // `ffmpeg -i` sai com código 1 (sem saída) mas descreve as trilhas em stderr.
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: "pipe" });
  } catch (error) {
    return String(error.stderr);
  }
  return "";
}

function processesMentioning(needle) {
  try {
    const out = execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" });
    return out
      .split("\n")
      .filter((l) => l.includes(needle) && !l.includes("vitest") && !l.includes("ps -axo"));
  } catch {
    return [];
  }
}

describe.skipIf(!enabled)("vídeo online — ponta a ponta com a internet real", () => {
  let root;
  let tools;
  let manager;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-e2e-"));
    tools = createTools({ binDir: path.join(root, "bin") });
    // Mesmo runtime JS que o app passa em produção (lá é o Electron rodando como Node).
    manager = createManager({
      dir: path.join(root, "online_videos"),
      tools,
      jsRuntime: () => `node:${process.execPath}`,
    });
  });

  afterAll(() => {
    manager?.cancelAll();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("instala yt-dlp e ffmpeg do GitHub, com checksum, e os dois executam", async () => {
    const events = [];
    const paths = await tools.ensure({ onProgress: (p) => events.push(p.tool) });
    expect(new Set(events)).toEqual(new Set(["yt-dlp", "ffmpeg"]));

    const ytdlp = execFileSync(paths.ytdlp, ["--version"], { encoding: "utf8" }).trim();
    expect(ytdlp).toMatch(/^\d{4}\.\d{2}\.\d{2}/);
    const ff = execFileSync(paths.ffmpeg, ["-version"], { encoding: "utf8" });
    expect(ff).toMatch(/^ffmpeg version/);

    const info = await tools.info();
    expect(info).toMatchObject({ ready: true, ytdlpVersion: ytdlp });
  }, 240_000);

  it("baixa um vídeo real: H.264 + AAC em MP4, com progresso que só sobe", async () => {
    const events = [];
    const res = await manager.ensure(SHORT, { maxHeight: 1080 }, (e) => events.push(e));
    expect(res).toMatchObject({ ok: true, id: SHORT, cached: false });
    expect(res.url).toBe(`louvorja://onlinevideo/${SHORT}.mp4`);

    const file = path.join(root, "online_videos", `${SHORT}.mp4`);
    expect(fs.statSync(file).size).toBeGreaterThan(100_000);
    expect(fs.existsSync(path.join(root, "online_videos", ".partial", SHORT))).toBe(false);

    const info = streamsOf(file, tools.paths().ffmpeg);
    expect(info).toMatch(/Video: h264/);
    expect(info).toMatch(/Audio: aac/);
    expect(info).toMatch(/Duration: 00:00:19/);

    const percents = events.filter((e) => e.phase === "downloading").map((e) => e.percent);
    expect(percents.length).toBeGreaterThan(0);
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    expect(events.at(-1).phase).toBe("done");
    expect(res.meta).toMatchObject({ vcodec: expect.stringMatching(/^avc1/) });
  }, 240_000);

  it("da segunda vez sai do cache, sem rede", async () => {
    const t0 = Date.now();
    const res = await manager.ensure(SHORT);
    expect(res).toMatchObject({ ok: true, cached: true });
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("vídeo que não existe vira 'unavailable', sem renovar o yt-dlp à toa", async () => {
    const before = (await tools.info()).ytdlpInstalledAt;
    const res = await manager.ensure("zzzzzzzzzzz");
    expect(res.ok).toBe(false);
    expect(res.error.kind).toMatch(/^(unavailable|private)$/);
    expect((await tools.info()).ytdlpInstalledAt).toBe(before);
    expect(manager.store.has("zzzzzzzzzzz")).toBe(false);
  }, 120_000);

  it("cancelar no meio mata o yt-dlp e o ffmpeg de verdade (sem processo órfão)", async () => {
    let started;
    const seen = new Promise((r) => (started = r));
    const p = manager.ensure(LONG, { maxHeight: 1080 }, (e) => {
      if (e.phase === "downloading" && e.percent > 0) started();
    });
    await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error("não começou")), 90_000))]);
    expect(processesMentioning(LONG).length).toBeGreaterThan(0);

    manager.cancel(LONG);
    const res = await p;
    expect(res).toMatchObject({ ok: false, error: { kind: "cancelled" } });

    await new Promise((r) => setTimeout(r, 2500));
    expect(processesMentioning(LONG)).toEqual([]);
    expect(manager.store.has(LONG)).toBe(false);
  }, 180_000);

  it("um vídeo que falhou não bloqueia o próximo", async () => {
    const [bad, good] = await Promise.all([manager.ensure("yyyyyyyyyyy"), manager.ensure(SHORT)]);
    expect(bad.ok).toBe(false);
    expect(good.ok).toBe(true);
  }, 180_000);
});

// Referência para quem lê: os execFile de fora só existem para o ps/ffmpeg acima.
void execFile;
