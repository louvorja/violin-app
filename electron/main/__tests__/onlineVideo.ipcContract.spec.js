// @vitest-environment node
import { describe, it, expect } from "vitest";
import Module, { createRequire } from "module";
import fs from "fs";
import os from "os";
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

const FUNCTIONS = ["status", "ensure", "stream", "cancel", "list", "keep", "prepare", "remove", "clear"];

function withFakeElectron(platform, fn) {
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
    app: { getPath: () => { seen.appGetPathCalls += 1; return os.tmpdir(); } },
  };
  const electron = new Proxy(stub, { get: (target, key) => (key in target ? target[key] : () => {}) });

  const originalLoad = Module._load;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Module._load = function (request, ...rest) {
    return request === "electron" ? electron : originalLoad.call(this, request, ...rest);
  };
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  for (const f of [PRELOAD, INDEX]) delete require.cache[f];
  try {
    return fn(seen);
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, "platform", originalPlatform);
    for (const f of [PRELOAD, INDEX]) delete require.cache[f];
  }
}

describe.each(["darwin", "win32", "linux"])("vídeo online: preload e main (%s)", (platform) => {
  it("cada função do preload chama um canal que o main atende, com os mesmos argumentos, e nada fica sem par", () => {
    withFakeElectron(platform, (seen) => {
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
  it("diagnóstico inativo não inicializa o gerenciador nem consulta caminhos", () => {
    withFakeElectron("win32", (seen) => {
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
        online_video_background_admission_blocked: false,
        online_video_streaming: 0,
        online_video_jobs: [],
      });
      expect(seen.appGetPathCalls).toBe(0);
    });
  });

  it("guarda o bloqueio de background antes de o manager nascer", () => {
    withFakeElectron("win32", (seen) => {
      const onlineVideo = require(INDEX);
      onlineVideo.setBackgroundAdmissionBlocked(true);
      expect(onlineVideo.diagnosticSnapshot()).toMatchObject({
        online_video_manager_initialized: false,
        online_video_background_admission_blocked: true,
      });
      expect(seen.appGetPathCalls).toBe(0);

      onlineVideo.serveStream("abcdefghijk", "video", {
        headers: { get: () => null },
        signal: undefined,
      });
      expect(onlineVideo.diagnosticSnapshot()).toMatchObject({
        online_video_manager_initialized: true,
        online_video_background_admission_blocked: true,
      });
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
