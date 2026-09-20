// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import crypto from "crypto";

const require = createRequire(import.meta.url);
const { createTools, parseSums, YTDLP_ASSETS, FFMPEG_ASSETS } = require("../onlineVideo/tools.js");

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const YTDLP_V1 = Buffer.from("#!/bin/sh\necho 2026.01.02\n");
const YTDLP_V2 = Buffer.from("#!/bin/sh\necho 2026.03.04\n");
const FFMPEG = Buffer.from('#!/bin/sh\necho "ffmpeg version 6.1 Copyright"\n');
const FFMPEG_GZ = zlib.gzipSync(FFMPEG);

let server;
let origin;
let hits;
let ytdlpBody;
let sumsOverride;
let ffmpegGz;
/** Quando definido, o servidor segura a resposta do ffmpeg até o teste liberar. */
let ffmpegGate = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    if (req.url === "/yt/SHA2-256SUMS") {
      return send(200, sumsOverride ?? `${sha(ytdlpBody)}  yt-dlp_fake\n`);
    }
    if (req.url === "/yt/yt-dlp_fake") return send(200, ytdlpBody, { "content-length": ytdlpBody.length });
    if (req.url === "/redir/SHA2-256SUMS") return send(302, "", { location: "/yt/SHA2-256SUMS" });
    if (req.url === "/redir/yt-dlp_fake") return send(302, "", { location: "/yt/yt-dlp_fake" });
    if (req.url === "/ff/ffmpeg-fake.gz") {
      const reply = () => send(200, ffmpegGz, { "content-length": ffmpegGz.length });
      return ffmpegGate ? ffmpegGate.then(reply) : reply();
    }
    if (req.url === "/loop/a") return send(302, "", { location: "/loop/a" });
    return send(404, "nope");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

let binDir;

function make(overrides = {}) {
  return createTools({
    binDir,
    platform: "linux",
    arch: "x64",
    ytdlpBase: `${origin}/yt`,
    ffmpegBase: `${origin}/ff`,
    ytdlpAssets: { "linux-x64": "yt-dlp_fake" },
    ffmpegAssets: { "linux-x64": { name: "ffmpeg-fake.gz", sha256: sha(FFMPEG_GZ) } },
    ...overrides,
  });
}

beforeEach(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-tools-"));
  hits = [];
  ytdlpBody = YTDLP_V1;
  sumsOverride = undefined;
  ffmpegGz = FFMPEG_GZ;
  ffmpegGate = null;
});

afterEach(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

describe("parseSums", () => {
  it("acha o hash do asset, com CRLF e marcador de binário", () => {
    const h1 = "a".repeat(64);
    const h2 = "b".repeat(64);
    const text = `${h1}  yt-dlp\r\n${h2} *yt-dlp_macos\r\n`;
    expect(parseSums(text, "yt-dlp")).toBe(h1);
    expect(parseSums(text, "yt-dlp_macos")).toBe(h2);
  });

  it("devolve null quando o asset não está na lista, sem casar por prefixo", () => {
    const text = `${"a".repeat(64)}  yt-dlp_macos\n`;
    expect(parseSums(text, "yt-dlp")).toBeNull();
    expect(parseSums("", "yt-dlp")).toBeNull();
  });
});

describe("tabelas de assets", () => {
  it("cobrem as plataformas que o app publica, com SHA-256 válido para o ffmpeg", () => {
    for (const key of ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"]) {
      expect(YTDLP_ASSETS[key], key).toBeTruthy();
      expect(FFMPEG_ASSETS[key], key).toBeTruthy();
      expect(FFMPEG_ASSETS[key].sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("Windows ARM64 reaproveita o ffmpeg x64 (emulação)", () => {
    expect(FFMPEG_ASSETS["win32-arm64"]).toBe(FFMPEG_ASSETS["win32-x64"]);
  });
});

describe.skipIf(process.platform === "win32")("createTools", () => {
  it("instala as duas ferramentas, executáveis, e registra a versão", async () => {
    const tools = make();
    expect(tools.ready()).toBe(false);
    const events = [];
    const paths = await tools.ensure({ onProgress: (p) => events.push(p) });

    expect(paths).toEqual({ ytdlp: path.join(binDir, "yt-dlp"), ffmpeg: path.join(binDir, "ffmpeg") });
    expect(tools.ready()).toBe(true);
    for (const f of Object.values(paths)) {
      expect(fs.statSync(f).mode & 0o111).not.toBe(0);
    }
    expect(fs.readFileSync(paths.ffmpeg)).toEqual(FFMPEG); // gunzip devolve o original

    expect(new Set(events.map((e) => e.tool))).toEqual(new Set(["yt-dlp", "ffmpeg"]));
    expect(events.every((e) => typeof e.received === "number")).toBe(true);

    const info = await tools.info();
    expect(info).toMatchObject({ supported: true, ready: true, ytdlpVersion: "2026.01.02" });
    expect(info.ytdlpInstalledAt).toBeGreaterThan(0);
  });

  it("é idempotente: com tudo instalado não toca a rede", async () => {
    const tools = make();
    await tools.ensure();
    hits.length = 0;
    await tools.ensure();
    expect(hits).toEqual([]);
  });

  it("chamadas simultâneas compartilham um único download", async () => {
    const tools = make();
    await Promise.all([tools.ensure(), tools.ensure(), tools.ensure()]);
    expect(hits.filter((u) => u === "/yt/yt-dlp_fake")).toHaveLength(1);
    expect(hits.filter((u) => u === "/ff/ffmpeg-fake.gz")).toHaveLength(1);
  });

  it("segue redirecionamentos, como o GitHub faz", async () => {
    const tools = make({ ytdlpBase: `${origin}/redir` });
    await tools.ensure();
    expect(tools.ready()).toBe(true);
  });

  it("recusa ffmpeg cujo SHA-256 não confere e não deixa resto no disco", async () => {
    const tools = make({
      ffmpegAssets: { "linux-x64": { name: "ffmpeg-fake.gz", sha256: "0".repeat(64) } },
    });
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "tool" });
    expect(fs.existsSync(path.join(binDir, "ffmpeg"))).toBe(false);
    expect(fs.readdirSync(binDir).filter((n) => n.endsWith(".download"))).toEqual([]);
  });

  it("recusa yt-dlp adulterado em relação ao SHA2-256SUMS", async () => {
    sumsOverride = `${"f".repeat(64)}  yt-dlp_fake\n`;
    const tools = make();
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "tool" });
    expect(fs.existsSync(path.join(binDir, "yt-dlp"))).toBe(false);
    expect(fs.readdirSync(binDir).filter((n) => n.endsWith(".download"))).toEqual([]);
  });

  it("recusa quando a release não publica checksum para o asset", async () => {
    sumsOverride = `${"a".repeat(64)}  outro_asset\n`;
    await expect(make().ensure()).rejects.toMatchObject({ kind: "tool" });
  });

  it("recusa binário que baixou certo mas não executa como yt-dlp", async () => {
    ytdlpBody = Buffer.from("#!/bin/sh\necho oops\n");
    const tools = make();
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "tool" });
    expect(fs.existsSync(path.join(binDir, "yt-dlp"))).toBe(false);
  });

  it("recusa ffmpeg que baixou certo mas não é ffmpeg", async () => {
    const bad = zlib.gzipSync(Buffer.from("#!/bin/sh\necho nada\n"));
    ffmpegGz = bad;
    const tools = make({
      ffmpegAssets: { "linux-x64": { name: "ffmpeg-fake.gz", sha256: sha(bad) } },
    });
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "tool" });
    expect(fs.existsSync(path.join(binDir, "ffmpeg"))).toBe(false);
  });

  it("HTTP de erro vira falha de rede", async () => {
    const tools = make({ ffmpegBase: `${origin}/inexistente` });
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "network" });
  });

  it("desiste de laço de redirecionamento", async () => {
    const tools = make({ ytdlpBase: `${origin}/loop` });
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "network" });
  });

  it("chega cancelado: nem baixa", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(make().ensure({ signal: controller.signal })).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(hits).toEqual([]);
  });

  it("cancelar quem pediu não derruba a instalação: o pedido seguinte a aproveita, sem baixar de novo", async () => {
    let release;
    ffmpegGate = new Promise((r) => (release = r));
    const tools = make();
    const controller = new AbortController();
    const first = tools.ensure({ signal: controller.signal });
    await vi.waitFor(() => expect(hits).toContain("/ff/ffmpeg-fake.gz")); // já no ffmpeg

    controller.abort(); // o operador trocou de vídeo no meio da instalação
    await expect(first).rejects.toMatchObject({ kind: "cancelled" });

    const events = [];
    const second = tools.ensure({ onProgress: (p) => events.push(p.tool) });
    release();
    await expect(second).resolves.toEqual(tools.paths());
    expect(tools.ready()).toBe(true);
    expect(hits.filter((u) => u === "/ff/ffmpeg-fake.gz")).toHaveLength(1); // não recomeçou
    expect(hits.filter((u) => u === "/yt/yt-dlp_fake")).toHaveLength(1);
    expect(events).toContain("ffmpeg"); // quem chegou no meio também vê o andamento
  });

  it("quem chega no meio da instalação parte do andamento atual, não de zero", async () => {
    let release;
    ffmpegGate = new Promise((r) => (release = r));
    const tools = make();
    const early = [];
    const first = tools.ensure({ onProgress: (p) => early.push(p) });
    await vi.waitFor(() => expect(early.some((p) => p.tool === "yt-dlp")).toBe(true));

    const late = [];
    const second = tools.ensure({ onProgress: (p) => late.push(p) });
    await Promise.resolve(); // o andamento atual chega na hora, sem esperar o próximo byte
    expect(late.length).toBeGreaterThan(0);
    expect(late[0].tool).toBe("yt-dlp");
    expect(late[0].received).toBeGreaterThan(0);

    release();
    await Promise.all([first, second]);
  });

  it("cancelar um dos que esperam não atrapalha os outros", async () => {
    let release;
    ffmpegGate = new Promise((r) => (release = r));
    const tools = make();
    const controller = new AbortController();
    const a = tools.ensure({ signal: controller.signal });
    const b = tools.ensure();
    await vi.waitFor(() => expect(hits).toContain("/ff/ffmpeg-fake.gz"));
    controller.abort();
    await expect(a).rejects.toMatchObject({ kind: "cancelled" });
    release();
    await expect(b).resolves.toEqual(tools.paths());
  });

  it("instalação que falha sem ninguém esperando não vira rejeição sem dono, e a próxima tentativa recomeça", async () => {
    sumsOverride = `${"f".repeat(64)}  yt-dlp_fake\n`;
    const tools = make();
    const controller = new AbortController();
    const desistiu = tools.ensure({ signal: controller.signal });
    controller.abort();
    await expect(desistiu).rejects.toMatchObject({ kind: "cancelled" });
    // A falha da instalação em curso, sem ninguém esperando, não vira rejeição sem dono.
    await new Promise((r) => setTimeout(r, 50));
    sumsOverride = undefined;
    await expect(tools.ensure()).resolves.toEqual(tools.paths());
  });

  it("depois de uma falha, a próxima tentativa recomeça do zero", async () => {
    sumsOverride = `${"f".repeat(64)}  yt-dlp_fake\n`;
    const tools = make();
    await expect(tools.ensure()).rejects.toBeTruthy();
    sumsOverride = undefined;
    await expect(tools.ensure()).resolves.toBeTruthy();
    expect(tools.ready()).toBe(true);
  });

  it("refreshYtdlp troca pela versão nova e mantém o ffmpeg", async () => {
    const tools = make();
    await tools.ensure();
    const ffBefore = fs.readFileSync(path.join(binDir, "ffmpeg"));

    ytdlpBody = YTDLP_V2;
    const version = await tools.refreshYtdlp();
    expect(version).toBe("2026.03.04");
    expect((await tools.info()).ytdlpVersion).toBe("2026.03.04");
    expect(fs.readFileSync(path.join(binDir, "ffmpeg"))).toEqual(ffBefore);
  });

  it("refreshYtdlp que falha não estraga o yt-dlp que já funcionava", async () => {
    const tools = make();
    await tools.ensure();
    sumsOverride = `${"f".repeat(64)}  yt-dlp_fake\n`;
    await expect(tools.refreshYtdlp()).rejects.toBeTruthy();
    expect(fs.readFileSync(path.join(binDir, "yt-dlp"))).toEqual(YTDLP_V1);
    expect((await tools.info()).ytdlpVersion).toBe("2026.01.02");
  });

  it("ffmpegWorks: só o ffmpeg, sem depender do yt-dlp", async () => {
    const tools = make();
    expect(await tools.ffmpegWorks()).toBe(false); // nada instalado
    await tools.ensure();
    expect(await tools.ffmpegWorks()).toBe(true);

    fs.writeFileSync(path.join(binDir, "yt-dlp"), "#!/bin/sh\necho nada\n", { mode: 0o755 });
    expect(await tools.ffmpegWorks()).toBe(true); // yt-dlp quebrado não muda a resposta
    expect(await tools.works()).toBe(false);

    fs.writeFileSync(path.join(binDir, "ffmpeg"), Buffer.from([0, 1, 2, 3]), { mode: 0o755 });
    expect(await tools.ffmpegWorks()).toBe(false);
  });

  it("works: verdadeiro com tudo instalado", async () => {
    const tools = make();
    await tools.ensure();
    expect(await tools.works()).toBe(true);
  });

  it("works: falso sem binários, com ffmpeg corrompido ou com yt-dlp que não responde", async () => {
    const tools = make();
    expect(await tools.works()).toBe(false); // nada instalado ainda
    await tools.ensure();

    fs.writeFileSync(path.join(binDir, "ffmpeg"), Buffer.from([0, 1, 2, 3]), { mode: 0o755 });
    expect(await tools.works()).toBe(false);

    await tools.reset();
    await tools.ensure();
    expect(await tools.works()).toBe(true);

    fs.writeFileSync(path.join(binDir, "yt-dlp"), "#!/bin/sh\necho nada\n", { mode: 0o755 });
    expect(await tools.works()).toBe(false);
  });

  it("reset apaga os binários e a próxima instalação refaz tudo", async () => {
    const tools = make();
    await tools.ensure();
    await tools.reset();
    expect(tools.ready()).toBe(false);
    hits.length = 0;
    await tools.ensure();
    expect(hits).toContain("/yt/yt-dlp_fake");
  });
});

describe("plataforma sem suporte", () => {
  it("diz que não é suportada e recusa instalar", async () => {
    const tools = createTools({ binDir, platform: "freebsd", arch: "x64" });
    expect(tools.supported).toBe(false);
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "unsupported" });
    await expect(tools.refreshYtdlp()).rejects.toMatchObject({ kind: "unsupported" });
    expect((await tools.info()).supported).toBe(false);
  });

  it("Windows usa .exe", () => {
    const tools = createTools({ binDir, platform: "win32", arch: "x64" });
    expect(tools.paths().ytdlp.endsWith("yt-dlp.exe")).toBe(true);
    expect(tools.paths().ffmpeg.endsWith("ffmpeg.exe")).toBe(true);
  });
});
