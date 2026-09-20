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
