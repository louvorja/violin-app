// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import Module, { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

/**
 * A ponte do vídeo online tem três pontas que nenhum outro teste liga: o preload que o renderer
 * chama, os handlers que o main registra e o protocolo que serve as trilhas. Um refactor que troque
 * um canal de nome, mova o registro para dentro de uma condição ou desligue a rota do protocolo
 * deixa todos os testes do gerenciador verdes e o vídeo mudo — o renderer só vê "unknown" e cai no
 * player do YouTube. O preload e o registro são carregados de verdade, com o `electron` trocado por
 * um stub, uma vez por plataforma.
 */
const require = createRequire(import.meta.url);
const file = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const PRELOAD = file("../../preload.cjs");
const INDEX = file("../onlineVideo/index.js");
const MAIN = file("../../main.cjs");
const PROTOCOL = file("../protocol.js");
const PATHS = file("../paths.js");

const FUNCTIONS = ["status", "ensure", "stream", "cancel", "has", "list", "prefetch", "accountStatus", "accountLogin", "accountLogout", "collection", "keep", "prepare", "remove", "clear"];

async function withFakeElectron(platform, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-video-ipc-"));
  const seen = { exposed: null, invoked: [], listened: [], handlers: new Map(), appGetPathCalls: 0 };
  const stub = {
    contextBridge: {
      exposeInMainWorld: (_name, api) => {
        seen.exposed = api;
      },
    },
    ipcRenderer: {
      invoke: (channel, ...args) => {
        seen.invoked.push({ channel, args });
        return Promise.resolve({ ok: true });
      },
      send: () => {},
      on: (channel) => seen.listened.push(channel),
      off: () => {},
    },
    webUtils: { getPathForFile: () => "" },
    app: { getPath: (name) => { seen.appGetPathCalls += 1; return path.join(root, name); } },
  };
  const electron = new Proxy(stub, { get: (target, key) => (key in target ? target[key] : () => {}) });

  const originalLoad = Module._load;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Module._load = function (request, ...rest) {
    return request === "electron" ? electron : originalLoad.call(this, request, ...rest);
  };
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  for (const f of [PRELOAD, INDEX, PATHS]) delete require.cache[f];
  try {
    return await fn(seen);
  } finally {
    await require(INDEX).releaseDataDir();
    Module._load = originalLoad;
    Object.defineProperty(process, "platform", originalPlatform);
    for (const f of [PRELOAD, INDEX, PATHS]) delete require.cache[f];
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe.each(["darwin", "win32", "linux"])("vídeo online: preload e main (%s)", (platform) => {
  it("cada função do preload chama um canal que o main atende, com os mesmos argumentos, e nada fica sem par", async () => {
    await withFakeElectron(platform, (seen) => {
      require(PRELOAD);
      expect(seen.exposed.platform).toBe(platform);
      const api = seen.exposed.onlineVideo;
      expect(Object.keys(api).sort()).toEqual([...FUNCTIONS, "onProgress"].sort());

      const opts = { maxHeight: 720, keep: true };
      for (const name of FUNCTIONS) api[name]("abcdefghijk", opts);
      const called = seen.invoked.filter((c) => c.channel.startsWith("onlineVideo:"));
      const channels = FUNCTIONS.map((name) => `onlineVideo:${name}`).sort();
      expect(called.map((c) => c.channel).sort()).toEqual(channels);
      expect(called.find((c) => c.channel === "onlineVideo:stream").args).toEqual(["abcdefghijk", opts]);
      expect(called.find((c) => c.channel === "onlineVideo:ensure").args).toEqual(["abcdefghijk", opts]);
      expect(called.find((c) => c.channel === "onlineVideo:has").args).toEqual(["abcdefghijk"]);
      // Canal ou playlist: a fonte e a página seguem como vieram; o main as valida.
      expect(called.find((c) => c.channel === "onlineVideo:collection").args).toEqual(["abcdefghijk", opts]);

      require(INDEX).registerIpc({ handle: (channel, handler) => seen.handlers.set(channel, handler) });
      expect([...seen.handlers.keys()].sort()).toEqual(channels);
      for (const handler of seen.handlers.values()) expect(typeof handler).toBe("function");

      const off = api.onProgress(() => {});
      expect(seen.listened).toContain("onlineVideo:progress");
      expect(typeof off).toBe("function");
    });
  });
});

describe("vídeo online: o que fica de fora do carregamento do preload", () => {
  it("aguarda a mudança da pasta antes de consultar vídeos ou criar outro gerenciador", async () => {
    await withFakeElectron("darwin", async (seen) => {
      const onlineVideo = require(INDEX);
      onlineVideo.registerIpc({ handle: (channel, handler) => seen.handlers.set(channel, handler) });
      await onlineVideo.init();
      const previous = onlineVideo.getManager();
      const chosen = path.join(path.dirname(previous.store.dir), "..", "chosen");
      fs.mkdirSync(path.join(chosen, "Videos"), { recursive: true });
      fs.writeFileSync(path.join(chosen, "Videos", "abcdefghijk.mp4"), "offline video");
      let finishMove;
      const gate = new Promise((resolve) => { finishMove = resolve; });
      const change = onlineVideo.withDataDirChange(async () => {
        await gate;
        require(PATHS).setDataDir(chosen);
      });
      let consulted = false;
      const lookup = seen.handlers.get("onlineVideo:has")({}, "abcdefghijk").then((value) => { consulted = true; return value; });
      await Promise.resolve();
      expect(consulted).toBe(false);
      finishMove();
      await change;
      expect(await lookup).toBe(true);
      expect(onlineVideo.getManager()).not.toBe(previous);
      expect(onlineVideo.getManager().store.dir).toBe(path.join(path.resolve(chosen), "Videos"));
      // No macOS o yt-dlp fica desempacotado numa pasta própria (ver tools.js).
      expect(onlineVideo.getManager().tools.paths().ytdlp).toBe(
        path.join(path.resolve(chosen), "bin", "yt-dlp-dist", "yt-dlp_macos")
      );
    });
  });

  it("has valida o ID antes de inicializar o manager e consulta só um arquivo", async () => {
    await withFakeElectron("win32", async (seen) => {
      const onlineVideo = require(INDEX);
      onlineVideo.registerIpc({ handle: (channel, handler) => seen.handlers.set(channel, handler) });
      const has = seen.handlers.get("onlineVideo:has");
      expect(await has({}, "../invalid")).toBe(false);
      expect(await has({}, 123)).toBe(false);
      expect(seen.appGetPathCalls).toBe(0);

      const manager = onlineVideo.getManager();
      const lookup = vi.spyOn(manager.store, "has").mockReturnValueOnce(true).mockReturnValueOnce(false);
      expect(await has({}, "abcdefghijk")).toBe(true);
      expect(await has({}, "abcdefghijk")).toBe(false);
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(lookup).toHaveBeenCalledWith("abcdefghijk");
    });
  });

  it("diagnóstico inativo não inicializa o gerenciador nem consulta caminhos", async () => {
    await withFakeElectron("win32", (seen) => {
      const snapshot = require(INDEX).diagnosticSnapshot();
      expect(snapshot).toEqual({
        online_video_manager_initialized: false,
        online_video_active_count: 0,
        online_video_resolving_count: 0,
        online_video_session_count: 0,
        online_video_foreground_running: 0,
        online_video_background_running: 0,
        online_video_foreground_queued: 0,
        online_video_background_queued: 0,
        online_video_streaming: 0,
        online_video_jobs: [],
        last_stream_failure: null,
      });
      expect(seen.appGetPathCalls).toBe(0);
    });
  });

  it("o main envia o progresso no mesmo canal que o preload escuta", () => {
    expect(fs.readFileSync(INDEX, "utf8")).toContain('"onlineVideo:progress"');
  });

  it("main.cjs registra os handlers no nível do módulo, fora de qualquer condição de plataforma", () => {
    expect(fs.readFileSync(MAIN, "utf8")).toMatch(/^onlineVideo\.registerIpc\(ipcMain\);$/m);
  });

  it("runtime-health recebe o retrato de vídeo somente ao montar seu snapshot", () => {
    const source = fs.readFileSync(MAIN, "utf8");
    expect(source).toContain("onlineVideo.diagnosticSnapshot()");
    expect(source).toContain("...onlineVideoDiagnostics");
  });

  it("o protocolo louvorja://onlinestream entrega o pedido ao serveStream do vídeo online", () => {
    const source = fs.readFileSync(PROTOCOL, "utf8");
    expect(source).toMatch(/host === "onlinestream"/);
    expect(source).toMatch(/onlineVideo\.serveStream\(/);
  });
});
