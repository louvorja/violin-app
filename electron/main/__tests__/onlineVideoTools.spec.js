// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import crypto from "crypto";
import JSZip from "jszip";

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
/** Quando verdadeiro, o servidor publica um "zip" que não abre (com SHA-256 coerente). */
let zipBroken;
const zipCache = new Map();

/** O que a release publica em pasta: o executável e o `_internal` ao lado dele. */
async function zipFor(body) {
  if (zipBroken) return Buffer.from("isto não é um zip");
  const cacheKey = body.toString("base64");
  if (!zipCache.has(cacheKey)) {
    const zip = new JSZip();
    zip.file("yt-dlp_fake", body, { unixPermissions: 0o100755 });
    zip.file("_internal/base_library.zip", "pyz", { unixPermissions: 0o100644 });
    zipCache.set(cacheKey, await zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" }));
  }
  return zipCache.get(cacheKey);
}
let ffmpegGz;
let potZip;
let potBin;
/** Quando definido, o servidor segura a resposta do ffmpeg até o teste liberar. */
let ffmpegGate = null;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    hits.push(req.url);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    if (req.url === "/yt/SHA2-256SUMS") {
      const zip = await zipFor(ytdlpBody);
      return send(200, sumsOverride ?? `${sha(zip)}  yt-dlp_fake.zip\n${sha(ytdlpBody)}  yt-dlp_fake\n`);
    }
    if (req.url === "/yt/yt-dlp_fake.zip") {
      const zip = await zipFor(ytdlpBody);
      return send(200, zip, { "content-length": zip.length });
    }
    if (req.url === "/yt/yt-dlp_fake") return send(200, ytdlpBody, { "content-length": ytdlpBody.length });
    if (req.url === "/redir/SHA2-256SUMS") return send(302, "", { location: "/yt/SHA2-256SUMS" });
    if (req.url === "/redir/yt-dlp_fake.zip") return send(302, "", { location: "/yt/yt-dlp_fake.zip" });
    if (req.url === "/ff/ffmpeg-fake.gz") {
      const reply = () => send(200, ffmpegGz, { "content-length": ffmpegGz.length });
      return ffmpegGate ? ffmpegGate.then(reply) : reply();
    }
    if (req.url === "/pot/bgutil-plugin.zip") {
      return send(200, potZip ?? Buffer.alloc(0), { "content-length": (potZip ?? Buffer.alloc(0)).length });
    }
    if (req.url === "/pot/bgutil-pot-fake") {
      return send(200, potBin ?? Buffer.alloc(0), { "content-length": (potBin ?? Buffer.alloc(0)).length });
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
    ytdlpAssets: { "linux-x64": { zip: "yt-dlp_fake.zip", exe: "yt-dlp_fake", file: "yt-dlp_fake" } },
    ffmpegAssets: { "linux-x64": { name: "ffmpeg-fake.gz", sha256: sha(FFMPEG_GZ) } },
    // Os testes não baixam o provedor real do GitHub; quem testa o plugin
    // injeta os próprios assets.
    potAssets: {},
    ...overrides,
  });
}

beforeEach(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-tools-"));
  hits = [];
  ytdlpBody = YTDLP_V1;
  sumsOverride = undefined;
  zipBroken = false;
  ffmpegGz = FFMPEG_GZ;
  ffmpegGate = null;
  potZip = undefined;
  potBin = undefined;
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

    expect(paths.ffmpeg).toBe(path.join(binDir, "ffmpeg"));
    // A versão em pasta: o executável e o `_internal` que ele carrega, numa pasta só dela.
    expect(path.dirname(path.dirname(paths.ytdlp))).toBe(path.join(binDir, "ytdlp"));
    expect(path.basename(paths.ytdlp)).toBe("yt-dlp_fake");
    expect(fs.existsSync(path.join(path.dirname(paths.ytdlp), "_internal/base_library.zip"))).toBe(true);
    expect(hits).toContain("/yt/yt-dlp_fake.zip");
    expect(hits).not.toContain("/yt/yt-dlp_fake");
    expect(tools.ready()).toBe(true);
    for (const f of [paths.ytdlp, paths.ffmpeg]) {
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
    expect(hits.filter((u) => u === "/yt/yt-dlp_fake.zip")).toHaveLength(1);
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
    sumsOverride = `${"f".repeat(64)}  yt-dlp_fake.zip\n${"e".repeat(64)}  yt-dlp_fake\n`;
    const tools = make();
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "tool" });
    expect(tools.ready()).toBe(false);
    expect(fs.existsSync(path.join(binDir, "yt-dlp"))).toBe(false);
    expect(fs.readdirSync(path.join(binDir, "ytdlp"))).toEqual([]);
  });

  it("recusa quando a release não publica checksum para o asset", async () => {
    sumsOverride = `${"a".repeat(64)}  outro_asset\n`;
    await expect(make().ensure()).rejects.toMatchObject({ kind: "tool" });
  });

  it("recusa binário que baixou certo mas não executa como yt-dlp", async () => {
    ytdlpBody = Buffer.from("#!/bin/sh\necho oops\n");
    const tools = make();
    await expect(tools.ensure()).rejects.toMatchObject({ kind: "tool" });
    expect(tools.ready()).toBe(false);
    expect(fs.readdirSync(path.join(binDir, "ytdlp"))).toEqual([]);
  });

  it("zip que não abre cai no arquivo único da mesma release", async () => {
    zipBroken = true;
    const tools = make();
    const paths = await tools.ensure();
    expect(tools.ready()).toBe(true);
    expect(fs.readFileSync(paths.ytdlp)).toEqual(YTDLP_V1);
    expect(hits).toContain("/yt/yt-dlp_fake");
    expect((await tools.info()).ytdlpVersion).toBe("2026.01.02");
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
    expect(hits.filter((u) => u === "/yt/yt-dlp_fake.zip")).toHaveLength(1);
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
    sumsOverride = `${"f".repeat(64)}  outro_asset\n`;
    const tools = make();
    const controller = new AbortController();
    const desistiu = tools.ensure({ signal: controller.signal });
    controller.abort();
    await expect(desistiu).rejects.toMatchObject({ kind: "cancelled" });
    // A falha da instalação em curso, sem ninguém esperando, não vira rejeição sem dono.
    await new Promise((r) => setTimeout(r, 50));
    sumsOverride = undefined;
    const paths = await tools.ensure();
    expect(paths).toEqual(tools.paths());
    expect(tools.ready()).toBe(true);
  });

  it("depois de uma falha, a próxima tentativa recomeça do zero", async () => {
    sumsOverride = `${"f".repeat(64)}  outro_asset\n`;
    const tools = make();
    await expect(tools.ensure()).rejects.toBeTruthy();
    sumsOverride = undefined;
    await expect(tools.ensure()).resolves.toBeTruthy();
    expect(tools.ready()).toBe(true);
  });

  it("refreshYtdlp troca pela versão nova, noutra pasta, e mantém o ffmpeg", async () => {
    const tools = make();
    await tools.ensure();
    const ffBefore = fs.readFileSync(path.join(binDir, "ffmpeg"));
    const oldPath = tools.paths().ytdlp;

    ytdlpBody = YTDLP_V2;
    const version = await tools.refreshYtdlp();
    expect(version).toBe("2026.03.04");
    expect((await tools.info()).ytdlpVersion).toBe("2026.03.04");
    expect(fs.readFileSync(tools.paths().ytdlp)).toEqual(YTDLP_V2);
    // O que ainda roda a versão anterior não perde os arquivos no meio.
    expect(tools.paths().ytdlp).not.toBe(oldPath);
    expect(fs.readFileSync(oldPath)).toEqual(YTDLP_V1);
    expect(fs.readFileSync(path.join(binDir, "ffmpeg"))).toEqual(ffBefore);
  });

  it("refreshYtdlp sem release nova só lê a lista de SHA-256, não baixa de novo", async () => {
    const tools = make();
    await tools.ensure();
    hits.length = 0;
    expect(await tools.refreshYtdlp()).toBe("2026.01.02");
    expect(hits).toEqual(["/yt/SHA2-256SUMS"]);
  });

  it("refreshYtdlp que falha não estraga o yt-dlp que já funcionava", async () => {
    const tools = make();
    await tools.ensure();
    const before = tools.paths().ytdlp;
    sumsOverride = `${"f".repeat(64)}  yt-dlp_fake.zip\n${"e".repeat(64)}  yt-dlp_fake\n`;
    await expect(tools.refreshYtdlp()).rejects.toBeTruthy();
    expect(tools.paths().ytdlp).toBe(before);
    expect(fs.readFileSync(before)).toEqual(YTDLP_V1);
    expect((await tools.info()).ytdlpVersion).toBe("2026.01.02");
  });

  it("a versão atual sobrevive a reabrir o app (outra instância lê o tools.json)", async () => {
    await make().ensure();
    const reopened = make();
    expect(reopened.ready()).toBe(true);
    expect(path.basename(reopened.paths().ytdlp)).toBe("yt-dlp_fake");
  });

  it("cleanup apaga as versões trocadas e o arquivo único antigo, nunca a atual", async () => {
    const tools = make();
    await tools.ensure();
    const oldDir = path.dirname(tools.paths().ytdlp);
    ytdlpBody = YTDLP_V2;
    await tools.refreshYtdlp();
    fs.writeFileSync(path.join(binDir, "yt-dlp"), YTDLP_V1, { mode: 0o755 });

    await make().cleanup();
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(path.join(binDir, "yt-dlp"))).toBe(false);
    expect(fs.readFileSync(tools.paths().ytdlp)).toEqual(YTDLP_V2);
    expect(fs.readdirSync(path.join(binDir, "ytdlp"))).toHaveLength(1);
  });

  it("cleanup sem versão em pasta não apaga o arquivo único que ainda é o único yt-dlp", async () => {
    fs.writeFileSync(path.join(binDir, "yt-dlp"), YTDLP_V1, { mode: 0o755 });
    await make().cleanup();
    expect(fs.existsSync(path.join(binDir, "yt-dlp"))).toBe(true);
  });

  it("ffmpegWorks: só o ffmpeg, sem depender do yt-dlp", async () => {
    const tools = make();
    expect(await tools.ffmpegWorks()).toBe(false); // nada instalado
    await tools.ensure();
    expect(await tools.ffmpegWorks()).toBe(true);

    fs.writeFileSync(tools.paths().ytdlp, "#!/bin/sh\necho nada\n", { mode: 0o755 });
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

    fs.writeFileSync(tools.paths().ytdlp, "#!/bin/sh\necho nada\n", { mode: 0o755 });
    expect(await tools.works()).toBe(false);
  });

  it("reset apaga os binários e a próxima instalação refaz tudo", async () => {
    const tools = make();
    await tools.ensure();
    await tools.reset();
    expect(tools.ready()).toBe(false);
    hits.length = 0;
    await tools.ensure();
    expect(hits).toContain("/yt/yt-dlp_fake.zip");
  });
});

describe.skipIf(process.platform === "win32")("manutenção automática do yt-dlp", () => {
  const DAY = 24 * 60 * 60 * 1000;
  let clock;
  const timed = (overrides = {}) => make({ now: () => clock, ...overrides });

  beforeEach(() => {
    clock = 1_800_000_000_000;
  });

  it("versão recém-instalada não é checada: nem toca a rede", async () => {
    const tools = timed();
    await tools.ensure();
    hits.length = 0;
    clock += 3 * DAY;
    expect(await tools.checkForUpdate()).toMatchObject({ action: "fresh" });
    expect(hits).toEqual([]);
  });

  it("depois de uma semana, troca pela release nova; sem release nova, só lê a lista", async () => {
    const tools = timed();
    await tools.ensure();
    tools.markUsed();
    clock += 8 * DAY;
    hits.length = 0;
    expect(await tools.checkForUpdate()).toMatchObject({ action: "current", version: "2026.01.02" });
    expect(hits).toEqual(["/yt/SHA2-256SUMS"]);

    // No mesmo dia não checa de novo.
    hits.length = 0;
    expect(await tools.checkForUpdate()).toMatchObject({ action: "checked" });
    expect(hits).toEqual([]);

    clock += DAY + 1;
    ytdlpBody = YTDLP_V2;
    expect(await tools.checkForUpdate()).toMatchObject({ action: "updated", version: "2026.03.04" });
    expect(fs.readFileSync(tools.paths().ytdlp)).toEqual(YTDLP_V2);
  });

  it("quem não usa vídeo on-line há um mês não paga atualização, a menos que volte a abrir o módulo", async () => {
    const tools = timed();
    await tools.ensure();
    tools.markUsed();
    clock += 40 * DAY;
    hits.length = 0;
    expect(await tools.checkForUpdate()).toMatchObject({ action: "dormant" });
    expect(hits).toEqual([]);
    expect(await tools.checkForUpdate({ ignoreDormancy: true })).toMatchObject({ action: "current" });
  });

  it("checagem que falha (sem rede) não se repete no mesmo dia", async () => {
    const tools = timed();
    await tools.ensure();
    clock += 8 * DAY;
    const offline = timed({ ytdlpBase: `${origin}/inexistente` });
    await expect(offline.checkForUpdate()).rejects.toMatchObject({ kind: "network" });
    hits.length = 0;
    expect(await offline.checkForUpdate()).toMatchObject({ action: "checked" });
    expect(hits).toEqual([]);
  });

  it("migra o arquivo único das versões anteriores do app, sem esperar a semana", async () => {
    fs.writeFileSync(path.join(binDir, "yt-dlp"), YTDLP_V1, { mode: 0o755 });
    fs.writeFileSync(path.join(binDir, "ffmpeg"), FFMPEG, { mode: 0o755 });
    fs.writeFileSync(
      path.join(binDir, "tools.json"),
      JSON.stringify({ ytdlp: { version: "2026.01.02", sha256: sha(YTDLP_V1), installedAt: clock } })
    );
    const tools = timed();
    expect(tools.ready()).toBe(true);
    expect(tools.paths().ytdlp).toBe(path.join(binDir, "yt-dlp"));

    ytdlpBody = YTDLP_V2;
    expect(await tools.checkForUpdate()).toMatchObject({ action: "updated", version: "2026.03.04" });
    expect(path.basename(tools.paths().ytdlp)).toBe("yt-dlp_fake");
    // O antigo fica até a próxima abertura, quando nada deste processo o usa.
    expect(fs.existsSync(path.join(binDir, "yt-dlp"))).toBe(true);
    await timed().cleanup();
    expect(fs.existsSync(path.join(binDir, "yt-dlp"))).toBe(false);
  });

  it("markUsed grava no máximo uma vez por hora", async () => {
    const tools = timed();
    await tools.ensure();
    tools.markUsed();
    await vi.waitFor(async () => expect((await readMetaFile()).ytdlp.lastUsedAt).toBe(clock));
    const first = clock;
    clock += 10 * 60 * 1000;
    tools.markUsed();
    await new Promise((r) => setTimeout(r, 20));
    expect((await readMetaFile()).ytdlp.lastUsedAt).toBe(first);
  });

  it("preinstall instala tudo uma vez e, se falhar, só tenta de novo no dia seguinte", async () => {
    const offline = timed({ ffmpegBase: `${origin}/inexistente` });
    await expect(offline.preinstall()).rejects.toMatchObject({ kind: "network" });
    hits.length = 0;
    expect(await offline.preinstall()).toMatchObject({ action: "backoff" });
    expect(hits).toEqual([]);

    clock += DAY + 1;
    const tools = timed();
    expect(await tools.preinstall()).toMatchObject({ action: "installed" });
    expect(tools.ready()).toBe(true);
    expect(await tools.preinstall()).toMatchObject({ action: "ready" });
  });
});

async function readMetaFile() {
  return JSON.parse(fs.readFileSync(path.join(binDir, "tools.json"), "utf8"));
}

describe("provedor de PO token", () => {
  it("instala o binário e extrai o plugin do yt-dlp", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("yt_dlp_plugins/extractor/getpot_fake.py", "# plugin fake\n");
    potZip = await zip.generateAsync({ type: "nodebuffer" });
    potBin = Buffer.from('#!/bin/sh\necho "bgutil-pot 0.8.1"\n');

    const tools = make({
      potBase: `${origin}/pot`,
      potAssets: {
        "linux-x64": { name: "bgutil-pot-fake", sha256: sha(potBin) },
      },
      potPlugin: { name: "bgutil-plugin.zip", sha256: sha(potZip) },
    });
    const events = [];
    const paths = await tools.ensure({ onProgress: (p) => events.push(p) });

    expect(tools.potReady()).toBe(true);
    expect(paths.pot).toBeTruthy();
    expect(
      fs.existsSync(
        path.join(
          paths.pluginDir,
          "bgutil-ytdlp-pot-provider/yt_dlp_plugins/extractor/getpot_fake.py"
        )
      )
    ).toBe(true);
    expect((await tools.info()).potVersion).toBe("0.8.1");
    expect(events.some((e) => e.tool === "pot")).toBe(true);

    await tools.reset();
    expect(tools.potReady()).toBe(false);
  });

  it("zip com caminho fora da pasta não é extraído", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("../fora.py", "nope");
    potZip = await zip.generateAsync({ type: "nodebuffer" });
    potBin = Buffer.from('#!/bin/sh\necho "bgutil-pot 0.8.1"\n');
    const tools = make({
      potBase: `${origin}/pot`,
      potAssets: { "linux-x64": { name: "bgutil-pot-fake", sha256: sha(potBin) } },
      potPlugin: { name: "bgutil-plugin.zip", sha256: sha(potZip) },
    });
    await tools.ensure();
    expect(tools.potReady()).toBe(false);
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
