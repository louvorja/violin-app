// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  RENDERER_RESPONSE_CHANNEL,
  RendererRequestRegistry,
} = require("../rendererRequestRegistry.js");

const UUIDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

function fixture(options = {}) {
  const sender = { isDestroyed: () => false };
  let mainWindow = {
    isDestroyed: () => false,
    webContents: sender,
  };
  let uuidIndex = 0;
  const registry = new RendererRequestRegistry({
    getMainWindow: () => mainWindow,
    createId: () => UUIDS[uuidIndex++],
    ...options,
  });
  return {
    get mainWindow() {
      return mainWindow;
    },
    registry,
    sender,
    setMainWindow: (next) => {
      mainWindow = next;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RendererRequestRegistry", () => {
  it("resolve o contrato apenas pela porta fixa e pelo request id esperado", async () => {
    const { registry, sender } = fixture();
    const ipcMain = {
      on: vi.fn(),
      off: vi.fn(),
    };
    registry.attach(ipcMain);

    expect(ipcMain.on).toHaveBeenCalledWith(RENDERER_RESPONSE_CHANNEL, expect.any(Function));
    const listener = ipcMain.on.mock.calls[0][1];
    const pending = registry.request("slides", {
      validatePayload: (payload) => payload?.status === "ok",
    });
    expect(pending.requestId).toBe(`slides:${UUIDS[0]}`);

    listener(
      { sender },
      { requestId: pending.requestId, payload: { status: "ok", currentSlideIndex: 2 } }
    );

    await expect(pending.promise).resolves.toEqual({ status: "ok", currentSlideIndex: 2 });
    expect(registry.pendingCount).toBe(0);
  });

  it("não consome o request quando o sender não é a mainWindow", async () => {
    const { registry, sender } = fixture();
    const pending = registry.request("announcements");

    expect(
      registry.acceptResponse(
        { sender: { isDestroyed: () => false } },
        { requestId: pending.requestId, payload: { status: "forged" } }
      )
    ).toEqual({ accepted: false, reason: "INVALID_SENDER" });
    expect(registry.pendingCount).toBe(1);

    registry.acceptResponse(
      { sender },
      { requestId: pending.requestId, payload: { status: "ok" } }
    );
    await expect(pending.promise).resolves.toEqual({ status: "ok" });
  });

  it("descarta resposta duplicada ou obsoleta sem afetar outro request", async () => {
    const { registry, sender } = fixture();
    const first = registry.request("slides");
    const second = registry.request("slides");

    expect(
      registry.acceptResponse(
        { sender },
        { requestId: first.requestId, payload: { value: 1 } }
      )
    ).toMatchObject({ accepted: true });
    await expect(first.promise).resolves.toEqual({ value: 1 });

    expect(
      registry.acceptResponse(
        { sender },
        { requestId: first.requestId, payload: { value: 2 } }
      )
    ).toEqual({ accepted: false, reason: "STALE_REQUEST" });
    expect(registry.pendingCount).toBe(1);

    registry.acceptResponse(
      { sender },
      { requestId: second.requestId, payload: { value: 3 } }
    );
    await expect(second.promise).resolves.toEqual({ value: 3 });
  });

  it("expira, limpa e recusa uma resposta tardia", async () => {
    vi.useFakeTimers();
    const { registry, sender } = fixture();
    const pending = registry.request("libras", { timeoutMs: 100 });
    const rejected = expect(pending.promise).rejects.toMatchObject({ code: "TIMEOUT" });

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(registry.pendingCount).toBe(0);
    expect(
      registry.acceptResponse(
        { sender },
        { requestId: pending.requestId, payload: null }
      )
    ).toEqual({ accepted: false, reason: "STALE_REQUEST" });
  });

  it("valida prefixo, limite do registro, tamanho e contrato do payload", async () => {
    const { registry, sender } = fixture({ maxPending: 1 });
    expect(() => registry.request("../channel")).toThrowError(
      expect.objectContaining({ code: "INVALID_PREFIX" })
    );

    const pending = registry.request("slides", {
      maxPayloadBytes: 16,
      validatePayload: (payload) => payload?.status === "ok",
    });
    expect(() => registry.request("slides")).toThrowError(
      expect.objectContaining({ code: "REGISTRY_FULL" })
    );

    const rejected = expect(pending.promise).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(
      registry.acceptResponse(
        { sender },
        { requestId: pending.requestId, payload: { status: "x".repeat(100) } }
      )
    ).toEqual({ accepted: false, reason: "INVALID_PAYLOAD" });
    await rejected;
    expect(registry.pendingCount).toBe(0);

    const invalidContract = registry.request("slides", {
      maxPayloadBytes: 1_024,
      validatePayload: (payload) => payload?.status === "ok",
    });
    const invalidRejected = expect(invalidContract.promise).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    expect(
      registry.acceptResponse(
        { sender },
        { requestId: invalidContract.requestId, payload: { status: "unexpected" } }
      )
    ).toEqual({ accepted: false, reason: "INVALID_PAYLOAD" });
    await invalidRejected;
  });

  it("não deixa request atravessar troca ou fechamento da mainWindow", async () => {
    const { registry, setMainWindow } = fixture();
    const pending = registry.request("slides");
    const replacementSender = { isDestroyed: () => false };
    setMainWindow({
      isDestroyed: () => false,
      webContents: replacementSender,
    });
    const changed = expect(pending.promise).rejects.toMatchObject({ code: "WINDOW_CHANGED" });

    expect(
      registry.acceptResponse(
        { sender: replacementSender },
        { requestId: pending.requestId, payload: { status: "ok" } }
      )
    ).toEqual({ accepted: false, reason: "WINDOW_CHANGED" });
    await changed;
    expect(registry.pendingCount).toBe(0);

    setMainWindow({
      isDestroyed: () => true,
      webContents: { isDestroyed: () => true },
    });
    expect(() => registry.request("slides")).toThrowError(
      expect.objectContaining({ code: "RENDERER_UNAVAILABLE" })
    );
  });
});
