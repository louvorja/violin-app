// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { safeSend } = require("../safeWebContents.js");

function makeWebContents({ destroyed = false, sendImpl } = {}) {
  return {
    isDestroyed: () => destroyed,
    send: sendImpl || vi.fn(),
  };
}

describe("safeSend", () => {
  it("retorna false e não lança quando target é null/undefined", () => {
    expect(safeSend(null, "canal", { a: 1 })).toBe(false);
    expect(safeSend(undefined, "canal", { a: 1 })).toBe(false);
  });

  it("retorna false quando webContents está destruído", () => {
    const wc = makeWebContents({ destroyed: true });
    expect(safeSend(wc, "canal", { a: 1 })).toBe(false);
    expect(wc.send).not.toHaveBeenCalled?.();
  });

  it("retorna false quando target não possui isDestroyed()", () => {
    const target = { send: vi.fn() };
    expect(safeSend(target, "canal", {})).toBe(false);
  });

  it("envia com sucesso via webContents direto", () => {
    const sendImpl = vi.fn();
    const wc = makeWebContents({ destroyed: false, sendImpl });
    expect(safeSend(wc, "canal", { a: 1 })).toBe(true);
    expect(sendImpl).toHaveBeenCalledWith("canal", { a: 1 });
  });

  it("aceita uma BrowserWindow (com propriedade .webContents) e usa o webContents interno", () => {
    const sendImpl = vi.fn();
    const win = { webContents: makeWebContents({ destroyed: false, sendImpl }) };
    expect(safeSend(win, "canal", { b: 2 })).toBe(true);
    expect(sendImpl).toHaveBeenCalledWith("canal", { b: 2 });
  });

  it("retorna false quando BrowserWindow.webContents está destruído", () => {
    const win = { webContents: makeWebContents({ destroyed: true }) };
    expect(safeSend(win, "canal", {})).toBe(false);
  });

  it("captura exceção lançada por send() (janela fechou entre o check e o envio) e retorna false", () => {
    const sendImpl = vi.fn(() => {
      throw new Error("Object has been destroyed");
    });
    const wc = makeWebContents({ destroyed: false, sendImpl });
    expect(() => safeSend(wc, "canal", {})).not.toThrow();
    expect(safeSend(wc, "canal", {})).toBe(false);
  });

  it("não propaga payload no log de erro (apenas canal e motivo)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sendImpl = vi.fn(() => {
      throw new Error("destroyed");
    });
    const wc = makeWebContents({ destroyed: false, sendImpl });
    safeSend(wc, "meu-canal", { segredo: "nao-deve-aparecer" });
    expect(warnSpy).toHaveBeenCalled();
    const loggedArgs = warnSpy.mock.calls[0];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain("nao-deve-aparecer");
    expect(serialized).toContain("meu-canal");
    warnSpy.mockRestore();
  });
});
