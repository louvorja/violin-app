// @vitest-environment node
/**
 * Quadros de áudio recusados pelo Chromium saem do `louvorja://` como silêncio.
 *
 * O contrato que o player depende: (1) só os bytes dos quadros recusados mudam,
 * em resposta inteira ou parcial; (2) enquanto a varredura corre, nada além do
 * ponto conferido é entregue; (3) varredura parada nunca prende a entrega; (4)
 * o arquivo mudou no disco, a troca antiga não vale mais.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import Path from "@/helpers/Path";

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(join(tmpdir(), "lj-audio-repair-"));
let handleRequest;

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub("electron", {
  protocol: {
    handle: (_scheme, handler) => {
      handleRequest = handler;
    },
  },
  app: { getAppPath: () => root },
});
stub("../paths.js", { filesDir: () => join(root, "files") });
stub("../onlineVideo/index.js", { fileFor: () => null });

const protocol = require("../protocol.js");
const audioRepair = require("../audioRepair/index.js");
const { buildMp4 } = require("./fixtures/mp4Builder.cjs");

const SIZES = [40, 52, 33, 61, 47, 29];
let n = 0;

function newVideo(extra = {}) {
  const built = buildMp4({ sizes: SIZES, perChunk: [2, 2, 2], ...extra });
  const file = join(root, `v${n++}.mp4`);
  fs.writeFileSync(file, built.file);
  return { ...built, path: file, url: Path.local(file) };
}

function expected(built, bad) {
  const copy = Buffer.from(built.file);
  for (const i of bad) {
    const silent = audioRepair.SILENT_FRAMES[2];
    const frame = Buffer.alloc(built.sizes[i]);
    silent.copy(frame);
    frame.copy(copy, built.positions[i]);
  }
  return copy;
}

async function body(url, range) {
  const res = await handleRequest(
    new Request(url, range ? { headers: { Range: range } } : undefined)
  );
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function scanAll(video, bad) {
  const plan = await audioRepair.begin(video.path);
  expect(plan.state).toBe("scan");
  expect(audioRepair.report(plan.token, { upto: plan.count, bad, done: true })).toMatchObject({
    ok: true,
  });
  return plan;
}

beforeAll(() => {
  protocol.handle();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  audioRepair._resetForTests();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("varredura", () => {
  it("entrega ao renderer a configuração e os bytes de cada quadro", async () => {
    const video = newVideo();
    const plan = await audioRepair.begin(video.path);
    expect(plan).toMatchObject({
      state: "scan",
      codec: "mp4a.40.2",
      sampleRate: 48000,
      numberOfChannels: 2,
      count: SIZES.length,
      video_codec: "avc1",
      audio_codec: "mp4a",
    });
    expect(Buffer.from(plan.description)).toEqual(Buffer.from([0x11, 0x90]));

    const block = await audioRepair.read(plan.token, 1, 4);
    expect(block.sizes).toEqual(SIZES.slice(1, 5));
    expect(Buffer.from(block.data)).toEqual(Buffer.concat(video.frames.slice(1, 5)));
  });

  it("arquivo já conferido nesta sessão não é varrido de novo", async () => {
    const video = newVideo();
    await scanAll(video, [2]);
    expect(await audioRepair.begin(video.path)).toMatchObject({ state: "done", patched: 1 });
  });

  it("segunda janela não varre o que a primeira está varrendo", async () => {
    const video = newVideo();
    await audioRepair.begin(video.path);
    expect(await audioRepair.begin(video.path)).toEqual({ state: "scanning" });
  });

  it("arquivo ausente ou fora do formato não segura nada", async () => {
    expect(await audioRepair.begin(join(root, "nao-existe.mp4"))).toEqual({
      state: "unsupported",
      reason: "not_found",
    });
    const text = join(root, "texto.mp4");
    fs.writeFileSync(text, "não sou vídeo");
    expect(await audioRepair.begin(text)).toMatchObject({ state: "unsupported", reason: "no_moov" });
    expect(audioRepair.forFile(text, fs.statSync(text))).toBeNull();
  });
});

describe("entrega pelo louvorja://local", () => {
  it("troca só os quadros recusados, inteiro e por faixa", async () => {
    const video = newVideo();
    await scanAll(video, [1, 4]);
    const want = expected(video, [1, 4]);

    const whole = await body(video.url);
    expect(whole.status).toBe(200);
    expect(whole.bytes).toEqual(want);

    // Faixa que começa no meio de um quadro trocado e termina no meio de outro.
    const from = video.positions[1] + 5;
    const to = video.positions[4] + 10;
    const part = await body(video.url, `bytes=${from}-${to}`);
    expect(part.status).toBe(206);
    expect(part.bytes).toEqual(want.subarray(from, to + 1));
  });

  it("a varredura registrada por outra grafia do caminho vale para o protocolo", async () => {
    const video = newVideo();
    // No Windows a URL vira `C:/...` e o caminho nativo é `C:\...`; aqui, `/./`.
    const outraGrafia = `${dirname(video.path)}${sep}.${sep}${basename(video.path)}`;
    const plan = await audioRepair.begin(outraGrafia);
    audioRepair.report(plan.token, { upto: plan.count, bad: [3], done: true });
    expect((await body(video.url)).bytes).toEqual(expected(video, [3]));
  });

  it("arquivo sem quadro recusado segue pelo caminho de sempre", async () => {
    const video = newVideo();
    await scanAll(video, []);
    expect(audioRepair.forFile(video.path, fs.statSync(video.path))).toBeNull();
    expect((await body(video.url)).bytes).toEqual(video.file);
  });

  it("não entrega bytes além do ponto já conferido", async () => {
    const video = newVideo();
    const plan = await audioRepair.begin(video.path);
    let settled = false;
    const pending = body(video.url).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    audioRepair.report(plan.token, { upto: 3, bad: [2] });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    audioRepair.report(plan.token, { upto: plan.count, bad: [5], done: true });
    expect((await pending).bytes).toEqual(expected(video, [2, 5]));
  });

  it("varredura parada libera a entrega sem trocar nada a mais", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    const video = newVideo();
    const plan = await audioRepair.begin(video.path);
    audioRepair.report(plan.token, { upto: 2, bad: [0] });
    const reparo = audioRepair.forFile(video.path, fs.statSync(video.path));
    const waiting = reparo.waitFor(video.file.length);
    expect(waiting).toBeInstanceOf(Promise);

    vi.advanceTimersByTime(audioRepair.SCAN_STALL_MS + 600);
    await waiting;
    expect(reparo.waitFor(video.file.length)).toBeNull();
    expect(await audioRepair.begin(video.path)).toMatchObject({ state: "scan" });
  });

  it("um pedaço nunca espera mais que o teto, mesmo com a varredura viva", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    const video = newVideo();
    const plan = await audioRepair.begin(video.path);
    const reparo = audioRepair.forFile(video.path, fs.statSync(video.path));
    let released = false;
    reparo.waitFor(video.file.length).then(() => (released = true));
    // A varredura continua dando sinal de vida, mas não chega ao fim.
    for (let t = 0; t < audioRepair.CHUNK_WAIT_MAX_MS; t += 400) {
      await audioRepair.read(plan.token, 0, 1);
      vi.advanceTimersByTime(400);
    }
    await Promise.resolve();
    expect(released).toBe(true);
  });

  it("um pedido de vários pedaços espera no total o teto, não o teto por pedaço", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    // ~10 pedaços de 64 KB: o salto para longe do ponto conferido.
    const video = newVideo({ sizes: Array(10).fill(70_000), perChunk: [4, 3, 3] });
    const plan = await audioRepair.begin(video.path);
    // Conta as esperas que o pedido abriu: o relógio falso avança enquanto o
    // disco lê, então medir o tempo dependeria da máquina.
    let waits = 0;
    const forFile = audioRepair.forFile;
    vi.spyOn(audioRepair, "forFile").mockImplementation((...args) => {
      const reparo = forFile(...args);
      if (!reparo) return reparo;
      return {
        ...reparo,
        waitFor(...waitArgs) {
          const espera = reparo.waitFor(...waitArgs);
          if (espera) waits++;
          return espera;
        },
      };
    });
    let settled = false;
    const pending = body(video.url).then((r) => {
      settled = true;
      return r;
    });
    // A varredura dá sinal de vida, mas não avança: só o teto libera a entrega.
    for (let i = 0; i < 200 && !settled; i++) {
      await audioRepair.read(plan.token, 0, 1);
      vi.advanceTimersByTime(250);
      // Leituras do disco são I/O de verdade: dê voltas ao laço para concluírem.
      for (let k = 0; k < 30 && !settled; k++) await new Promise((r) => setImmediate(r));
    }
    expect(settled).toBe(true);
    expect(waits).toBe(1);
    expect((await pending).bytes).toEqual(video.file);
  });

  it("arquivo alterado no disco perde a troca antiga", async () => {
    const video = newVideo();
    await scanAll(video, [3]);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(video.path, later, later);
    expect(audioRepair.forFile(video.path, fs.statSync(video.path))).toBeNull();
    expect((await body(video.url)).bytes).toEqual(video.file);
  });

  it("quadro menor que o silêncio fica como está e é contado", async () => {
    const video = newVideo({ sizes: [40, 5, 33, 61, 47, 29] });
    const plan = await audioRepair.begin(video.path);
    expect(audioRepair.report(plan.token, { upto: plan.count, bad: [1], done: true })).toEqual({
      ok: true,
      patched: 0,
      unpatchable: 1,
    });
  });
});

describe("IPC", () => {
  it("o renderer só nomeia o arquivo por louvorja://local", async () => {
    const handlers = new Map();
    audioRepair.registerIpc(
      { handle: (channel, fn) => handlers.set(channel, fn) },
      protocol.localPathFromUrl
    );
    expect([...handlers.keys()]).toEqual([
      "audioRepair:begin",
      "audioRepair:read",
      "audioRepair:report",
    ]);
    const begin = handlers.get("audioRepair:begin");
    expect(await begin({}, "file:///etc/passwd")).toEqual({
      state: "unsupported",
      reason: "not_local",
    });
    // `a/../b` o parser de URL já normaliza; a barra codificada chega inteira.
    expect(await begin({}, "louvorja://local/a/..%2Fb.mp4")).toEqual({
      state: "unsupported",
      reason: "not_local",
    });
    const video = newVideo();
    expect(await begin({}, video.url)).toMatchObject({ state: "scan" });
    expect(await handlers.get("audioRepair:read")({}, "token-que-nao-existe", 0, 1)).toBeNull();
  });

  it("main registra os handlers com o mesmo caminho que o protocolo serve", () => {
    const main = fs.readFileSync(join(__dirname, "../../main.cjs"), "utf8");
    expect(main).toMatch(
      /require\("\.\/main\/audioRepair\/index\.js"\)\.registerIpc\(ipcMain, protocolModule\.localPathFromUrl\)/
    );
  });
});
