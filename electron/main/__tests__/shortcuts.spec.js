// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const shortcutsPath = require.resolve("../shortcuts.js");
let originalElectron;
let shortcuts;
let focused;
let callbacks;

function windowMock() {
  return { webContents: { isDestroyed: () => false, send: vi.fn() } };
}

beforeEach(() => {
  focused = null;
  callbacks = new Map();
  originalElectron = require.cache[electronPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      BrowserWindow: { getFocusedWindow: () => focused },
      globalShortcut: {
        register: (accelerator, callback) => {
          callbacks.set(accelerator, callback);
          return true;
        },
        unregisterAll: vi.fn(),
      },
    },
  };
  delete require.cache[shortcutsPath];
  shortcuts = require("../shortcuts.js");
  shortcuts.enable();
});

afterEach(() => {
  delete require.cache[shortcutsPath];
  if (originalElectron) require.cache[electronPath] = originalElectron;
  else delete require.cache[electronPath];
  vi.restoreAllMocks();
});

describe("teclas multimídia chegam à autoridade de reprodução", () => {
  it.each(["projeção", "retorno", "principal", "nenhuma"])(
    "Play/Pause chega uma vez à principal com foco em %s",
    (focus) => {
      const main = windowMock();
      const auxiliary = windowMock();
      shortcuts.setMainWindow(main);
      focused = focus === "principal" ? main : focus === "nenhuma" ? null : auxiliary;

      callbacks.get("MediaPlayPause")();

      expect(main.webContents.send).toHaveBeenCalledExactlyOnceWith("shortcut", {
        action: "audio:toggle",
        payload: {},
      });
      expect(auxiliary.webContents.send).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["MediaNextTrack", "slide:next"],
    ["MediaPreviousTrack", "slide:prev"],
  ])("%s também chega à principal com projeção em foco", (key, action) => {
    const main = windowMock();
    focused = windowMock();
    shortcuts.setMainWindow(main);

    callbacks.get(key)();

    expect(main.webContents.send).toHaveBeenCalledExactlyOnceWith("shortcut", {
      action,
      payload: {},
    });
    expect(focused.webContents.send).not.toHaveBeenCalled();
  });

  it("não envia à auxiliar quando a principal não existe", () => {
    focused = windowMock();
    expect(() => callbacks.get("MediaPlayPause")()).not.toThrow();
    expect(focused.webContents.send).not.toHaveBeenCalled();
  });

  it("descarta a tecla com segurança quando a principal já foi destruída", () => {
    const main = windowMock();
    main.webContents.isDestroyed = () => true;
    focused = windowMock();
    shortcuts.setMainWindow(main);

    expect(() => callbacks.get("MediaPlayPause")()).not.toThrow();
    expect(main.webContents.send).not.toHaveBeenCalled();
    expect(focused.webContents.send).not.toHaveBeenCalled();
  });
});
