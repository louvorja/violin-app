// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import os from "os";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

const require = createRequire(import.meta.url);
const runner = require("../onlineVideo/runner.js");
const { isVideoId, watchUrl } = require("../onlineVideo/ids.js");

const ID = "T8YHfGrk3ok";

describe("ids", () => {
  it("aceita só IDs de 11 caracteres do alfabeto do YouTube", () => {
    expect(isVideoId("jNQXAC9IVRw")).toBe(true);
    expect(isVideoId("a-b_c-d_e-f")).toBe(true);
  });

  it("recusa qualquer coisa que possa virar opção, caminho ou URL", () => {
    for (const bad of [
      "",
      "short",
      "toolongvideoid1",
      "../../etc/pw",
      "abc def ghij",
      "--exec=calc.",
      "https://x.com/",
      "jNQXAC9IVR/",
      null,
      undefined,
      12345678901,
      ["jNQXAC9IVRw"],
    ]) {
      expect(isVideoId(bad)).toBe(false);
    }
  });

  it("monta a URL só a partir de um ID válido", () => {
    expect(watchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(() => watchUrl("../x")).toThrow();
  });
});

describe("formatSelector", () => {
  it("prefere H.264 + AAC até a altura pedida, sem recomprimir", () => {
    const f = runner.formatSelector(1080);
    const alternatives = f.split("/");
    expect(alternatives[0]).toBe("bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]");
    expect(alternatives[1]).toContain("[ext=mp4]");
    expect(alternatives.at(-1)).toBe("b[height<=1080]");
  });

  it("para tocar direto, cada alternativa exige um arquivo servido por HTTP (nada de fragmentos ou HLS)", () => {
    const alternatives = runner.formatSelector(1080, { direct: true }).split("/");
    expect(alternatives).toHaveLength(4);
    expect(alternatives[0]).toBe(
      "bv*[height<=1080][vcodec^=avc1][protocol=https]+ba[acodec^=mp4a][protocol=https]"
    );
    for (const alt of alternatives) {
      for (const part of alt.split("+")) expect(part).toContain("[protocol=https]");
    }
    // o seletor de baixar não muda
    expect(runner.formatSelector(1080)).not.toContain("protocol");
  });

  it("só aceita alturas conhecidas e cai em 1080", () => {
    expect(runner.formatSelector(720)).toContain("height<=720");
    expect(runner.formatSelector(480)).toContain("height<=480");
    expect(runner.formatSelector(4320)).toContain("height<=1080");
    expect(runner.formatSelector("1080; rm -rf /")).toContain("height<=1080");
    expect(runner.formatSelector(undefined)).toContain("height<=1080");
  });
});

describe("buildArgs", () => {
  const base = { id: ID, outDir: "/tmp/out", ffmpegPath: "/bin/ffmpeg", maxHeight: 1080 };

  it("ignora a configuração do usuário e nunca baixa playlist", () => {
    const args = runner.buildArgs(base);
    expect(args).toContain("--ignore-config");
    expect(args).toContain("--no-playlist");
  });

  it("junta trilhas em MP4 usando o ffmpeg informado", () => {
    const args = runner.buildArgs(base);
    expect(args[args.indexOf("--merge-output-format") + 1]).toBe("mp4");
    expect(args[args.indexOf("--ffmpeg-location") + 1]).toBe("/bin/ffmpeg");
  });

  it("termina com a URL montada a partir do ID e nenhum argumento depois dela", () => {
    const args = runner.buildArgs(base);
    expect(args.at(-1)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it("recusa ID que não seja de vídeo em vez de montar a linha de comando", () => {
    expect(() => runner.buildArgs({ ...base, id: "--exec=calc" })).toThrow();
  });

  it("só passa runtime JS e cache quando informados", () => {
    expect(runner.buildArgs(base)).not.toContain("--js-runtimes");
    expect(runner.buildArgs(base)).not.toContain("--cache-dir");
    const args = runner.buildArgs({ ...base, jsRuntime: "node:/x/electron", cacheDir: "/c" });
    expect(args[args.indexOf("--js-runtimes") + 1]).toBe("node:/x/electron");
    expect(args[args.indexOf("--cache-dir") + 1]).toBe("/c");
  });

  it("imprime metadados e progresso num formato que o parser entende", () => {
    const args = runner.buildArgs(base);
    expect(args[args.indexOf("--print") + 1]).toMatch(/^before_dl:LJMETA /);
    expect(args[args.indexOf("--progress-template") + 1]).toMatch(/^download:LJPROG\|/);
    // --print implica --quiet; sem --progress a barra some
    expect(args).toContain("--progress");
  });
});

describe("parseLine (saída real do yt-dlp)", () => {
  it("lê os metadados", () => {
    expect(runner.parseLine("LJMETA 1080|1920|avc1.640028|mp4a.40.2|235|mp4")).toEqual({
      type: "meta",
      height: 1080,
      width: 1920,
      vcodec: "avc1.640028",
      acodec: "mp4a.40.2",
      duration: 235,
      ext: "mp4",
    });
  });

  it("lê uma linha de progresso com total conhecido", () => {
    const evt = runner.parseLine(
      "LJPROG|downloading|31744|433081|NA|3315668.547066441|0|t2/jNQXAC9IVRw.f133.mp4"
    );
    expect(evt).toMatchObject({
      type: "progress",
      status: "downloading",
      downloaded: 31744,
      total: 433081,
      eta: 0,
      file: "t2/jNQXAC9IVRw.f133.mp4",
    });
    expect(evt.speed).toBeCloseTo(3315668.5, 0);
  });

  it("usa a estimativa quando o total exato é NA", () => {
    const evt = runner.parseLine("LJPROG|downloading|100|NA|5000|10|3|f.mp4");
    expect(evt.total).toBe(5000);
  });

  it("não quebra com NA em tudo nem com caminho contendo |", () => {
    const evt = runner.parseLine("LJPROG|downloading|NA|NA|NA|NA|NA|a|b.mp4");
    expect(evt.downloaded).toBeNull();
    expect(evt.total).toBeNull();
    expect(evt.file).toBe("a|b.mp4");
  });

  it("ignora o que não é seu", () => {
    expect(runner.parseLine("[youtube] Extracting URL")).toBeNull();
    expect(runner.parseLine("")).toBeNull();
  });
});

describe("createProgressMapper", () => {
  const prog = (status, downloaded, total, file) => ({ status, downloaded, total, file });

  it("mapeia o vídeo para 0–92 e o áudio para 92–98, e nunca volta", () => {
    const map = runner.createProgressMapper();
    const seen = [
      map(prog("downloading", 0, 1000, "v.mp4")),
      map(prog("downloading", 500, 1000, "v.mp4")),
      map(prog("finished", 1000, 1000, "v.mp4")),
      map(prog("downloading", 10, 100, "a.m4a")),
      map(prog("downloading", 100, 100, "a.m4a")),
      map(prog("finished", 100, 100, "a.m4a")),
    ];
    expect(seen).toEqual([0, 46, 92, 93, 98, 98]);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it("nunca passa de 99: o 100 é do arquivo final pronto", () => {
    const map = runner.createProgressMapper();
    map(prog("finished", 1, 1, "v.mp4"));
    expect(map(prog("finished", 1, 1, "a.m4a"))).toBeLessThanOrEqual(99);
  });

  it("aguenta total desconhecido sem NaN", () => {
    const map = runner.createProgressMapper();
    expect(map(prog("downloading", null, null, "v.mp4"))).toBe(0);
  });
});

describe("classifyError", () => {
  const cases = [
    ["age", "ERROR: [youtube] X: Sign in to confirm your age. This video may be inappropriate for some users."],
    ["private", "ERROR: [youtube] X: Private video. Sign in if you've been granted access to this video"],
    ["geo", "ERROR: [youtube] X: The uploader has not made this video available in your country"],
    ["geo", "ERROR: Video unavailable. The uploader has blocked it in your country on copyright grounds"],
    ["live", "ERROR: [youtube] X: This live event will begin in 2 hours."],
    ["bot", "ERROR: [youtube] X: Sign in to confirm you’re not a bot"],
    ["unavailable", "ERROR: [youtube] X: Video unavailable"],
    // texto real do yt-dlp 2026.08.19 para um ID que não existe
    ["unavailable", "ERROR: [youtube] zzzzzzzzzzz: This video is unavailable"],
    ["unavailable", "ERROR: [youtube] X: This video is not available"],
    ["unavailable", "ERROR: [youtube] X: This video has been removed by the uploader"],
    ["disk", "ERROR: unable to write data: [Errno 28] No space left on device"],
    ["format", "ERROR: [youtube] X: Requested format is not available. Use --list-formats"],
    ["forbidden", "ERROR: unable to download video data: HTTP Error 403: Forbidden"],
    ["network", "ERROR: [youtube] X: Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided"],
    ["network", "ERROR: <urlopen error _ssl.c:1000: The handshake operation timed out>"],
    ["unknown", "ERROR: something nobody has seen before"],
    ["unknown", ""],
  ];
  it.each(cases)("%s ← %s", (kind, text) => {
    expect(runner.classifyError(text)).toBe(kind);
  });

  it("só pede yt-dlp novo para o que uma versão nova pode resolver", () => {
    for (const kind of ["unknown", "forbidden", "format", "bot"]) {
      expect(runner.needsFreshTool(kind)).toBe(true);
    }
    for (const kind of ["age", "private", "geo", "live", "unavailable", "network", "disk", "cancelled"]) {
      expect(runner.needsFreshTool(kind)).toBe(false);
    }
  });
});

/** Processo falso: o teste controla stdout/stderr e o fechamento. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = undefined;
  return child;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lj-runner-"));
}

const tools = { ytdlp: "/fake/yt-dlp", ffmpeg: "/fake/ffmpeg" };

describe("run", () => {
  it("relata progresso, lê os metadados e devolve o arquivo final", async () => {
    const outDir = tmpDir();
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const onProgress = vi.fn();

    const promise = runner.run({ tools, id: ID, outDir, onProgress, spawnImpl });
    child.stdout.write("LJMETA 1080|1920|avc1.640028|mp4a.40.2|235|mp4\n");
    child.stdout.write("LJPROG|downloading|500|1000|NA|1000|1|v.mp4\n");
    child.stdout.write("LJPROG|finished|1000|1000|NA|1000|NA|v.mp4\n");
    child.stdout.write("LJPROG|downloading|50|100|NA|1000|1|a.m4a\n");
    await new Promise((r) => setTimeout(r, 10));
    fs.writeFileSync(path.join(outDir, `${ID}.mp4`), "video");
    child.emit("close", 0);

    const result = await promise;
    expect(result.file).toBe(path.join(outDir, `${ID}.mp4`));
    expect(result.size).toBe(5);
    expect(result.meta).toMatchObject({ height: 1080, vcodec: "avc1.640028" });

    const percents = onProgress.mock.calls.map(([p]) => p.percent);
    expect(percents.length).toBe(3);
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    expect(spawnImpl.mock.calls[0][0]).toBe("/fake/yt-dlp");
    // execFile-style: sem shell, argumentos como array
    expect(Array.isArray(spawnImpl.mock.calls[0][1])).toBe(true);
    expect(spawnImpl.mock.calls[0][2].shell).toBeUndefined();
  });

  it("junta linhas de stdout partidas no meio", async () => {
    const outDir = tmpDir();
    const child = fakeChild();
    const onProgress = vi.fn();
    const promise = runner.run({ tools, id: ID, outDir, onProgress, spawnImpl: () => child });
    child.stdout.write("LJPROG|downloading|5");
    child.stdout.write("00|1000|NA|1|1|v.mp4\n");
    await new Promise((r) => setTimeout(r, 10));
    fs.writeFileSync(path.join(outDir, `${ID}.mp4`), "x");
    child.emit("close", 0);
    await promise;
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0].downloaded).toBe(500);
  });

  it("rejeita com o tipo do erro que o yt-dlp escreveu", async () => {
    const child = fakeChild();
    const promise = runner.run({ tools, id: ID, outDir: tmpDir(), spawnImpl: () => child });
    child.stderr.write("ERROR: [youtube] T8YHfGrk3ok: Private video. Sign in if you've been granted access\n");
    await new Promise((r) => setTimeout(r, 10));
    child.emit("close", 1);
    await expect(promise).rejects.toMatchObject({ name: "OnlineVideoError", kind: "private" });
  });

  it("acusa quando sai com sucesso mas não deixou o MP4", async () => {
    const child = fakeChild();
    const promise = runner.run({ tools, id: ID, outDir: tmpDir(), spawnImpl: () => child });
    child.emit("close", 0);
    await expect(promise).rejects.toMatchObject({ kind: "format" });
  });

  it("acusa arquivo vazio como falha", async () => {
    const outDir = tmpDir();
    const child = fakeChild();
    const promise = runner.run({ tools, id: ID, outDir, spawnImpl: () => child });
    fs.writeFileSync(path.join(outDir, `${ID}.mp4`), "");
    child.emit("close", 0);
    await expect(promise).rejects.toMatchObject({ kind: "format" });
  });

  it("reporta binário que não executa como falha da ferramenta", async () => {
    const child = fakeChild();
    const promise = runner.run({ tools, id: ID, outDir: tmpDir(), spawnImpl: () => child });
    child.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" }));
    await expect(promise).rejects.toMatchObject({ kind: "tool" });
  });

  it("reporta exceção síncrona do spawn como falha da ferramenta", async () => {
    const spawnImpl = () => {
      throw new Error("boom");
    };
    await expect(
      runner.run({ tools, id: ID, outDir: tmpDir(), spawnImpl })
    ).rejects.toMatchObject({ kind: "tool" });
  });

  it("cancela: encerra o processo e rejeita como cancelled", async () => {
    const child = fakeChild();
    const killImpl = vi.fn();
    const controller = new AbortController();
    const promise = runner.run({
      tools,
      id: ID,
      outDir: tmpDir(),
      signal: controller.signal,
      spawnImpl: () => child,
      killImpl,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
    expect(killImpl).toHaveBeenCalledWith(child);
    // o close tardio do processo morto não pode transformar em sucesso
    child.emit("close", 143);
  });

  it("nem sobe o processo se já chegou cancelado", async () => {
    const spawnImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runner.run({ tools, id: ID, outDir: tmpDir(), signal: controller.signal, spawnImpl })
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("desiste de conexão muda: sem nenhuma saída por stallMs, mata e classifica como rede", async () => {
    const child = fakeChild();
    const killImpl = vi.fn();
    const promise = runner.run({
      tools,
      id: ID,
      outDir: tmpDir(),
      spawnImpl: () => child,
      killImpl,
      stallMs: 40,
    });
    await expect(promise).rejects.toMatchObject({ kind: "network" });
    expect(killImpl).toHaveBeenCalledWith(child);
  });

  it("qualquer saída reinicia o relógio de inatividade", async () => {
    const outDir = tmpDir();
    const child = fakeChild();
    const killImpl = vi.fn();
    const promise = runner.run({
      tools,
      id: ID,
      outDir,
      spawnImpl: () => child,
      killImpl,
      stallMs: 60,
    });
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 30));
      child.stdout.write(`LJPROG|downloading|${i}|100|NA|1|1|v.mp4\n`);
    }
    fs.writeFileSync(path.join(outDir, `${ID}.mp4`), "x");
    child.emit("close", 0);
    await expect(promise).resolves.toMatchObject({ size: 1 });
    expect(killImpl).not.toHaveBeenCalled();
  });

  it("passa PYTHONIOENCODING e só liga o Electron-como-Node quando há runtime node:", async () => {
    const outDir = tmpDir();
    const capture = [];
    const finishing = (extra) => {
      const child = fakeChild();
      const spawnImpl = vi.fn(() => child);
      const p = runner.run({ tools, id: ID, outDir, spawnImpl, ...extra });
      fs.writeFileSync(path.join(outDir, `${ID}.mp4`), "x");
      setTimeout(() => child.emit("close", 0), 5);
      return p.then(() => capture.push(spawnImpl.mock.calls[0][2].env));
    };
    await finishing({});
    await finishing({ jsRuntime: "node:/x/Electron" });
    expect(capture[0].PYTHONIOENCODING).toBe("utf-8");
    expect(capture[0].ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(capture[1].ELECTRON_RUN_AS_NODE).toBe("1");
  });
});

const GV = "https://rr1---sn-2apnuxaxjvh-nw2e.googlevideo.com/videoplayback";
const EXPIRE = 1789960552;
/** Forma do `requested_formats` que o yt-dlp devolve (testado contra o yt-dlp de verdade). */
const videoFormat = (extra = {}) => ({
  format_id: "137",
  ext: "mp4",
  vcodec: "avc1.640028",
  acodec: "none",
  height: 1080,
  width: 1920,
  protocol: "https",
  filesize: 73460124,
  url: `${GV}?expire=${EXPIRE}&mime=video%2Fmp4&c=VISIONOS`,
  ...extra,
});
const audioFormat = (extra = {}) => ({
  format_id: "140",
  ext: "m4a",
  vcodec: "none",
  acodec: "mp4a.40.2",
  protocol: "https",
  url: `${GV}?expire=${EXPIRE + 5}&mime=audio%2Fmp4&c=VISIONOS`,
  ...extra,
});

describe("parseStreams (o que o yt-dlp devolve para tocar direto)", () => {
  it("entrega o link do vídeo e o do áudio (trilhas separadas), a altura e quando vencem", () => {
    const out = runner.parseStreams({
      duration: 235,
      requested_formats: [videoFormat(), audioFormat()],
    });
    expect(out.muxed).toBe(false);
    expect(out.video).toMatchObject({ height: 1080, width: 1920, vcodec: "avc1.640028", ext: "mp4", size: 73460124 });
    expect(out.video.url).toContain("mime=video%2Fmp4");
    expect(out.audio.url).toContain("mime=audio%2Fmp4");
    expect(out.audio).toMatchObject({ acodec: "mp4a.40.2", ext: "m4a" });
    expect(out.duration).toBe(235);
    expect(out.expiresAt).toBe(EXPIRE * 1000); // o que vence primeiro
  });

  it("o tamanho vem do `clen` da URL (o do arquivo); estimativa nunca serve para dimensionar", () => {
    const withClen = (n) => `${GV}?expire=${EXPIRE}&clen=${n}`;
    const out = runner.parseStreams({
      requested_formats: [
        videoFormat({ url: withClen(73460124), filesize: 1, filesize_approx: 999 }),
        audioFormat({ url: withClen(3811304), filesize: null, filesize_approx: 5 }),
      ],
    });
    expect(out.video.size).toBe(73460124);
    expect(out.audio.size).toBe(3811304);

    const noExact = runner.parseStreams({
      requested_formats: [
        videoFormat({ url: GV, filesize: null, filesize_approx: 999 }),
        audioFormat({ url: GV, filesize: null, filesize_approx: 5 }),
      ],
    });
    expect(noExact.video.size).toBeNull();
    expect(noExact.audio.size).toBeNull();
  });

  it("sem `clen`, usa o filesize exato do formato", () => {
    const out = runner.parseStreams({
      requested_formats: [videoFormat({ url: GV, filesize: 500 }), audioFormat({ url: GV, filesize: 70 })],
    });
    expect(out.video.size).toBe(500);
    expect(out.audio.size).toBe(70);
  });

  it("formato único com som: imagem e som saem do mesmo link", () => {
    const out = runner.parseStreams({
      duration: 60,
      ...videoFormat({ acodec: "mp4a.40.2", format_id: "22", height: 720 }),
    });
    expect(out.muxed).toBe(true);
    expect(out.audio.url).toBe(out.video.url);
    expect(out.video.height).toBe(720);
  });

  it("a ordem das trilhas não importa", () => {
    const out = runner.parseStreams({ requested_formats: [audioFormat(), videoFormat()] });
    expect(out.video.url).toContain("video%2Fmp4");
    expect(out.audio.url).toContain("audio%2Fmp4");
  });

  it("sem parâmetro de validade, assume meia hora a partir de agora", () => {
    const out = runner.parseStreams(
      { requested_formats: [videoFormat({ url: GV }), audioFormat({ url: GV })] },
      1_000_000
    );
    expect(out.expiresAt).toBe(1_000_000 + 30 * 60 * 1000);
  });

  it("só aceita link https do googlevideo: outro host, http ou lixo viram erro", () => {
    for (const url of [
      "https://evil.example.com/videoplayback",
      "https://googlevideo.com.evil.com/videoplayback",
      "http://rr1---sn-x.googlevideo.com/videoplayback",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "louvorja://onlinevideo/T8YHfGrk3ok.mp4",
      "não é url",
      "",
      null,
      undefined,
    ]) {
      expect(() => runner.parseStreams({ requested_formats: [videoFormat({ url }), audioFormat()] })).toThrow(
        expect.objectContaining({ kind: "format" })
      );
    }
  });

  it("um áudio de fora do googlevideo não é aproveitado: sem trilha de áudio, é erro", () => {
    expect(() =>
      runner.parseStreams({ requested_formats: [videoFormat(), audioFormat({ url: "https://evil.example.com/a" })] })
    ).toThrow(expect.objectContaining({ kind: "format" }));
  });

  it("vídeo sem nenhuma trilha de áudio servida é erro (a projeção ficaria muda)", () => {
    expect(() => runner.parseStreams({ requested_formats: [videoFormat()] })).toThrow(
      expect.objectContaining({ kind: "format" })
    );
  });

  it("transmissão ao vivo não toca por aqui", () => {
    expect(() => runner.parseStreams({ is_live: true, requested_formats: [videoFormat(), audioFormat()] })).toThrow(
      expect.objectContaining({ kind: "live" })
    );
  });

  it("resposta que não é objeto é erro, não exceção solta", () => {
    for (const bad of [null, undefined, "x", 5]) {
      expect(() => runner.parseStreams(bad)).toThrow(expect.objectContaining({ kind: "format" }));
    }
  });
});

describe("buildResolveArgs", () => {
  it("pede só o JSON (sem baixar) com o seletor direto, sem shell e sem configuração do usuário", () => {
    const args = runner.buildResolveArgs({ id: ID, maxHeight: 720 });
    expect(args).toContain("-J");
    expect(args).toContain("--ignore-config");
    expect(args).toContain("--no-playlist");
    expect(args[args.indexOf("-f") + 1]).toBe(runner.formatSelector(720, { direct: true }));
    expect(args.at(-1)).toBe(watchUrl(ID));
    for (const download of ["-o", "--no-simulate", "--merge-output-format", "--ffmpeg-location"]) {
      expect(args).not.toContain(download);
    }
  });

  it("cache e runtime de JavaScript só entram quando informados", () => {
    expect(runner.buildResolveArgs({ id: ID })).not.toContain("--js-runtimes");
    const args = runner.buildResolveArgs({ id: ID, cacheDir: "/c", jsRuntime: "node:/x" });
    expect(args[args.indexOf("--cache-dir") + 1]).toBe("/c");
    expect(args[args.indexOf("--js-runtimes") + 1]).toBe("node:/x");
  });
});

describe("resolveStreams", () => {
  const json = (extra = {}) =>
    JSON.stringify({ duration: 235, requested_formats: [videoFormat(), audioFormat()], ...extra });

  it("lê o JSON do stdout e devolve os links, sem baixar nada", async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const promise = runner.resolveStreams({ tools, id: ID, spawnImpl });
    child.stdout.write(json().slice(0, 40));
    child.stdout.write(json().slice(40)); // chega em pedaços
    child.emit("close", 0);
    const out = await promise;
    expect(out.video.url).toContain("video%2Fmp4");
    expect(out.audio.url).toContain("audio%2Fmp4");
    expect(spawnImpl.mock.calls[0][0]).toBe("/fake/yt-dlp");
    expect(Array.isArray(spawnImpl.mock.calls[0][1])).toBe(true);
    expect(spawnImpl.mock.calls[0][2].shell).toBeUndefined();
  });

  it("só liga o Electron-como-Node quando o runtime é node:", async () => {
    const run = async (jsRuntime) => {
      const child = fakeChild();
      const spawnImpl = vi.fn(() => child);
      const p = runner.resolveStreams({ tools, id: ID, jsRuntime, spawnImpl });
      child.stdout.write(json());
      child.emit("close", 0);
      await p;
      return spawnImpl.mock.calls[0][2].env;
    };
    expect((await run("node:/x/Electron")).ELECTRON_RUN_AS_NODE).toBe("1");
    expect((await run(undefined)).ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("classifica o erro do yt-dlp (vídeo privado, removido, rede…)", async () => {
    const child = fakeChild();
    const promise = runner.resolveStreams({ tools, id: ID, spawnImpl: () => child });
    child.stderr.write("ERROR: [youtube] T8YHfGrk3ok: Private video. Sign in if you've been granted access\n");
    child.emit("close", 1);
    await expect(promise).rejects.toMatchObject({ name: "OnlineVideoError", kind: "private" });
  });

  it("saída que não é JSON vira erro de formato, não exceção solta", async () => {
    const child = fakeChild();
    const promise = runner.resolveStreams({ tools, id: ID, spawnImpl: () => child });
    child.stdout.write("isto não é json");
    child.emit("close", 0);
    await expect(promise).rejects.toMatchObject({ kind: "format" });
  });

  it("um link de fora do googlevideo na resposta é recusado", async () => {
    const child = fakeChild();
    const promise = runner.resolveStreams({ tools, id: ID, spawnImpl: () => child });
    child.stdout.write(json({ requested_formats: [videoFormat({ url: "https://evil.example.com/v" }), audioFormat()] }));
    child.emit("close", 0);
    await expect(promise).rejects.toMatchObject({ kind: "format" });
  });

  it("cancelar mata o yt-dlp e rejeita como cancelado", async () => {
    const child = fakeChild();
    const killImpl = vi.fn();
    const controller = new AbortController();
    const promise = runner.resolveStreams({ tools, id: ID, spawnImpl: () => child, killImpl, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
    expect(killImpl).toHaveBeenCalledWith(child);
  });

  it("já cancelado antes de começar: nem executa o yt-dlp", async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnImpl = vi.fn();
    await expect(runner.resolveStreams({ tools, id: ID, spawnImpl, signal: controller.signal })).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("sem resposta no prazo: mata o yt-dlp e acusa rede", async () => {
    const child = fakeChild();
    const killImpl = vi.fn();
    const promise = runner.resolveStreams({ tools, id: ID, spawnImpl: () => child, killImpl, timeoutMs: 30 });
    await expect(promise).rejects.toMatchObject({ kind: "network" });
    expect(killImpl).toHaveBeenCalledWith(child);
  });

  it("resposta enorme demais é cortada em vez de encher a memória", async () => {
    const child = fakeChild();
    const killImpl = vi.fn();
    const promise = runner.resolveStreams({ tools, id: ID, spawnImpl: () => child, killImpl });
    child.stdout.write("x".repeat(9 * 1024 * 1024));
    await expect(promise).rejects.toMatchObject({ kind: "format" });
    expect(killImpl).toHaveBeenCalledWith(child);
  });

  it("o yt-dlp que nem sobe (antivírus, arquitetura errada) vira erro de ferramenta", async () => {
    await expect(
      runner.resolveStreams({
        tools,
        id: ID,
        spawnImpl: () => {
          throw new Error("EACCES");
        },
      })
    ).rejects.toMatchObject({ kind: "tool" });
  });
});

describe("muxCopy (junta as trilhas sem recodificar)", () => {
  const opts = (extra = {}) => ({ ffmpeg: "/fake/ffmpeg", video: "/t/video.mp4", audio: "/t/audio.m4a", out: "", ...extra });

  it("copia os pacotes (sem recodificar), põe o índice no começo e não usa shell", async () => {
    const out = path.join(tmpDir(), "out.mp4");
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const promise = runner.muxCopy(opts({ out, spawnImpl }));
    fs.writeFileSync(out, "mp4");
    child.emit("close", 0);
    await expect(promise).resolves.toEqual({ file: out, size: 3 });

    const [bin, args, options] = spawnImpl.mock.calls[0];
    expect(bin).toBe("/fake/ffmpeg");
    expect(Array.isArray(args)).toBe(true);
    expect(options.shell).toBeUndefined();
    expect(args.slice(args.indexOf("-c"), args.indexOf("-c") + 2)).toEqual(["-c", "copy"]);
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args.filter((a, i) => args[i - 1] === "-i")).toEqual(["/t/video.mp4", "/t/audio.m4a"]);
    expect(args).toEqual(expect.arrayContaining(["0:v:0", "1:a:0"]));
    expect(args.at(-1)).toBe(out);
    for (const recode of ["-c:v", "-c:a", "libx264", "aac"]) expect(args).not.toContain(recode);
  });

  it("ffmpeg que sai com erro vira erro de formato com a última linha do que ele escreveu", async () => {
    const child = fakeChild();
    const promise = runner.muxCopy(opts({ out: path.join(tmpDir(), "o.mp4"), spawnImpl: () => child }));
    child.stderr.write("[mov,mp4] moov atom not found\nvideo.mp4: Invalid data found when processing input\n");
    await new Promise((r) => setTimeout(r, 5));
    child.emit("close", 1);
    await expect(promise).rejects.toMatchObject({ kind: "format", message: expect.stringContaining("Invalid data") });
  });

  it("saiu com sucesso mas não deixou o arquivo (ou deixou vazio): erro", async () => {
    for (const write of [false, true]) {
      const out = path.join(tmpDir(), "o.mp4");
      const child = fakeChild();
      const promise = runner.muxCopy(opts({ out, spawnImpl: () => child }));
      if (write) fs.writeFileSync(out, "");
      child.emit("close", 0);
      await expect(promise).rejects.toMatchObject({ kind: "format" });
    }
  });

  it("cancelar mata o ffmpeg e rejeita como cancelado", async () => {
    const child = fakeChild();
    const killImpl = vi.fn();
    const controller = new AbortController();
    const promise = runner.muxCopy(opts({ spawnImpl: () => child, killImpl, signal: controller.signal }));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
    expect(killImpl).toHaveBeenCalledWith(child);
  });

  it("já cancelado: nem executa o ffmpeg", async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnImpl = vi.fn();
    await expect(runner.muxCopy(opts({ spawnImpl, signal: controller.signal }))).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("ffmpeg pendurado: mata e acusa ferramenta", async () => {
    const child = fakeChild();
    const killImpl = vi.fn();
    const promise = runner.muxCopy(opts({ spawnImpl: () => child, killImpl, timeoutMs: 30 }));
    await expect(promise).rejects.toMatchObject({ kind: "tool" });
    expect(killImpl).toHaveBeenCalledWith(child);
  });

  it("o ffmpeg que nem sobe vira erro de ferramenta", async () => {
    await expect(
      runner.muxCopy(
        opts({
          spawnImpl: () => {
            throw new Error("EACCES");
          },
        })
      )
    ).rejects.toMatchObject({ kind: "tool" });
  });
});

describe.skipIf(process.platform === "win32")("killTree (processo de verdade)", () => {
  function alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it("encerra o processo e os netos dele", async () => {
    // Um shell que gera um neto: é o formato do yt-dlp (bootloader → python → ffmpeg).
    const child = spawn("sh", ["-c", "sleep 60 & echo $!; wait"], {
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    });
    const grandchild = await new Promise((resolve) => {
      child.stdout.once("data", (d) => resolve(Number(String(d).trim())));
    });
    expect(alive(child.pid)).toBe(true);
    expect(alive(grandchild)).toBe(true);

    runner.killTree(child);
    await new Promise((r) => child.once("close", r));
    await new Promise((r) => setTimeout(r, 100));

    expect(alive(child.pid)).toBe(false);
    expect(alive(grandchild)).toBe(false);
  });

  it("não falha com processo inexistente", () => {
    expect(() => runner.killTree(undefined)).not.toThrow();
    expect(() => runner.killTree({})).not.toThrow();
  });
});
