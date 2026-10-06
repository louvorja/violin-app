// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PRELOAD = fileURLToPath(new URL("../../preload.cjs", import.meta.url));
const { RENDERER_RESPONSE_CHANNEL } = require("../httpServer/rendererRequestRegistry.js");

function loadPreload() {
  const seen = {
    exposed: null,
    invoked: [],
    sent: [],
    listeners: new Map(),
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld: (_name, api) => {
        seen.exposed = api;
      },
    },
    ipcRenderer: {
      invoke: vi.fn((channel, ...args) => {
        seen.invoked.push({ channel, args });
        return Promise.resolve({ ok: true });
      }),
      send: vi.fn((channel, payload) => {
        seen.sent.push({ channel, payload });
      }),
      on: vi.fn((channel, handler) => seen.listeners.set(channel, handler)),
      off: vi.fn((channel) => seen.listeners.delete(channel)),
    },
    webUtils: { getPathForFile: () => "" },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === "electron" ? electron : originalLoad.call(this, request, ...rest);
  };
  delete require.cache[PRELOAD];
  try {
    require(PRELOAD);
    return seen;
  } finally {
    Module._load = originalLoad;
    delete require.cache[PRELOAD];
  }
}

describe("preload IPC contract", () => {
  it("não expõe invoke/on/send genéricos e preserva APIs específicas", async () => {
    const seen = loadPreload();
    const api = seen.exposed;

    expect(api).not.toHaveProperty("invoke");
    expect(api).not.toHaveProperty("on");
    expect(api).not.toHaveProperty("send");

    await api.userdata.fetch();
    await api.userdata.patch({ path: "options.theme", value: "dark", _src: "test" });
    await api.app.info();
    await api.dev.setLogForwarding(true);
    await api.dev.reloadAll();
    await api.dev.openDevTools();

    expect(seen.invoked).toEqual([
      { channel: "userdata:fetch", args: [] },
      {
        channel: "userdata:patch",
        args: [{ path: "options.theme", value: "dark", _src: "test" }],
      },
      { channel: "app:info", args: [] },
      { channel: "dev:setLogForwarding", args: [true] },
      { channel: "dev:reloadAll", args: [] },
      { channel: "dev:openDevTools", args: [] },
    ]);

    const onPatch = vi.fn();
    const off = api.userdata.onPatch(onPatch);
    const patch = { path: "options.theme", value: "light", _src: "other" };
    seen.listeners.get("userdata:patch")({}, patch);
    expect(onPatch).toHaveBeenCalledWith(patch);
    off();
    expect(seen.listeners.has("userdata:patch")).toBe(false);
  });

  it("responde somente pela porta fixa e rejeita request id fora do contrato", () => {
    const seen = loadPreload();
    const api = seen.exposed;
    const requestId = "slides:00000000-0000-4000-8000-000000000001";
    const payload = { status: "ok" };

    expect(api.httpServer.respond("arbitrary:channel", payload)).toBe(false);
    expect(api.httpServer.respond(requestId, payload)).toBe(true);
    expect(seen.sent).toEqual([
      {
        channel: RENDERER_RESPONSE_CHANNEL,
        payload: { requestId, payload },
      },
    ]);
  });

  // Cada prefixo novo precisa entrar em DOIS lugares: a lista de eventos de
  // `onHttpEvent` e o regex da `respond`. Esquecer o regex descarta a resposta
  // em silêncio e o main acaba com 504 (foi o bug da aba Vídeos Online).
  it("aceita o prefixo online-videos na resposta", () => {
    const seen = loadPreload();
    const api = seen.exposed;
    const requestId = "online-videos:00000000-0000-4000-8000-000000000002";
    const payload = { status: "ok", albums: [] };

    expect(api.httpServer.respond(requestId, payload)).toBe(true);
    expect(seen.sent).toEqual([
      { channel: RENDERER_RESPONSE_CHANNEL, payload: { requestId, payload } },
    ]);
  });

  it("onHttpEvent escuta http:online-videos junto dos demais eventos", () => {
    const seen = loadPreload();
    const api = seen.exposed;

    const cleanup = api.onHttpEvent(() => {});

    expect(seen.listeners.has("http:online-videos")).toBe(true);
    expect(seen.listeners.has("http:song-slides")).toBe(true);
    expect(seen.listeners.has("http:open-song")).toBe(true);
    cleanup();
    expect(seen.listeners.has("http:online-videos")).toBe(false);
  });

  it("aceita o prefixo custom-music na resposta", () => {
    const seen = loadPreload();
    const api = seen.exposed;
    const requestId = "custom-music:00000000-0000-4000-8000-000000000003";
    const payload = { status: "ok", songs: [] };

    expect(api.httpServer.respond(requestId, payload)).toBe(true);
    expect(seen.sent).toEqual([
      { channel: RENDERER_RESPONSE_CHANNEL, payload: { requestId, payload } },
    ]);
  });

  // O regex precisa acompanhar a lista de eventos — já erramos isso duas vezes
  // (online-videos e custom-music): a resposta era descartada em silêncio e a
  // rota respondia TIMEOUT sem nenhuma pista no renderer. Este teste varre os
  // prefixos conhecidos para o próximo esquecimento falhar aqui.
  it("todos os prefixos conhecidos passam pelo regex da respond", () => {
    const seen = loadPreload();
    const api = seen.exposed;
    const uuid = "00000000-0000-4000-8000-000000000004";

    for (const prefixo of ["slides", "announcements", "libras", "online-videos", "custom-music"]) {
      expect(
        api.httpServer.respond(`${prefixo}:${uuid}`, { status: "ok" }),
        `prefixo "${prefixo}" fora do contrato do preload`
      ).toBe(true);
    }
  });

  it("expõe apenas o sinal booleano de mídia ativa", () => {
    const seen = loadPreload();
    const api = seen.exposed;
    api.presentation.setMediaActive(true);
    api.presentation.setMediaActive("yes");
    api.presentation.setMediaActive(false);

    expect(seen.sent).toEqual([
      { channel: "presentation:media-active", payload: true },
      { channel: "presentation:media-active", payload: false },
    ]);
  });

});
