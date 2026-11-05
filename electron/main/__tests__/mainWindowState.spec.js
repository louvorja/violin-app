// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const source = new URL("../windows.js", import.meta.url);
const require = createRequire(source);
const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const SECONDARY = { workArea: { x: 1920, y: 0, width: 1280, height: 984 } };
const NORMAL = { x: 120, y: 80, width: 1100, height: 720 };

function setup({ platform = "win32", state = null, displays = [PRIMARY] } = {}) {
  let saved = state;
  const store = {
    get: vi.fn(() => saved),
    save: vi.fn((_feature, value) => { saved = structuredClone(value); }),
  };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width, height: options.height };
      this.maximized = false;
      this.minimized = false;
      this.fullscreen = false;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = vi.fn();
      this.loadURL = vi.fn();
      this.maximize = vi.fn(() => {
        this.maximized = true;
        if (!this.visible) this.show();
        this.emit("resize");
        this.emit("maximize");
      });
    }
    show() { this.visible = true; this.emit("show"); }
    isDestroyed() { return false; }
    isMinimized() { return this.minimized; }
    isFullScreen() { return this.fullscreen; }
    isMaximized() { return this.maximized && !this.minimized; }
    getNormalBounds() { return { ...this.bounds }; }
    unmaximize() { this.maximized = false; this.emit("unmaximize"); }
  }
  const electron = {
    BrowserWindow,
    app: { isPackaged: false },
    Menu: {},
    shell: {},
    screen: {
      getPrimaryDisplay: () => displays[0],
      getAllDisplays: () => displays,
      getDisplayMatching: (bounds) => displays.find(({ workArea: a }) =>
        bounds.x + bounds.width / 2 >= a.x && bounds.x + bounds.width / 2 < a.x + a.width
      ) || displays[0],
    },
  };
  const module = { exports: {} };
  runInNewContext(readFileSync(source, "utf8"), {
    module,
    require: (id) => id === "electron" ? electron : id === "./e2eWindowMode.js" ? { prepareWindow: () => {} } : require(id),
    process: { env: {}, platform },
    __dirname: fileURLToPath(new URL("../", import.meta.url)),
  });
  const open = () => module.exports.createMainWindow("http://localhost:5002", "/dist/index.html", "/preload.cjs", store);
  return { open, store };
}

describe("janela principal no Windows", () => {
  it("primeiro uso abre maximizado só quando o main revela a interface", () => {
    const { open, store } = setup();
    const win = open();
    expect(win.options.show).toBe(false);
    expect(win.visible).toBe(false);
    expect(win.maximize).not.toHaveBeenCalled();
    win.emit("resize");
    expect(store.save).not.toHaveBeenCalled();
    win.show();
    expect(win.isMaximized()).toBe(true);
    expect(store.save).toHaveBeenLastCalledWith("main", { maximized: true, bounds: win.bounds });
  });

  it("reabre com a posição e o tamanho escolhidos pelo usuário", () => {
    const { open } = setup();
    const win = open();
    win.show();
    win.unmaximize();
    win.bounds = NORMAL;
    win.emit("move");
    win.emit("resize");
    win.emit("close");
    const reopened = open();
    reopened.show();
    expect(reopened.bounds).toEqual(NORMAL);
    expect(reopened.isMaximized()).toBe(false);
  });

  it("lembra a maximização e preserva os bounds normais para restaurar", () => {
    const { open } = setup({ state: { maximized: false, bounds: NORMAL } });
    const win = open();
    win.show();
    win.maximize();
    win.emit("close");
    const reopened = open();
    reopened.show();
    expect(reopened.isMaximized()).toBe(true);
    expect(reopened.getNormalBounds()).toEqual(NORMAL);
  });

  it("fechar minimizado não apaga o estado maximizado", () => {
    const { open } = setup({ state: { maximized: true, bounds: NORMAL } });
    const win = open();
    win.show();
    win.minimized = true;
    win.emit("resize");
    win.emit("close");
    const reopened = open();
    reopened.show();
    expect(reopened.isMaximized()).toBe(true);
    expect(reopened.bounds).toEqual(NORMAL);
  });

  it("tela cheia temporária não substitui a preferência de janela normal", () => {
    const { open } = setup({ state: { maximized: false, bounds: NORMAL } });
    const win = open();
    win.show();
    win.fullscreen = true;
    win.maximized = true;
    win.emit("resize");
    win.emit("close");
    const reopened = open();
    reopened.show();
    expect(reopened.isMaximized()).toBe(false);
    expect(reopened.bounds).toEqual(NORMAL);
  });

  it("mostrar de novo a mesma janela não força outra maximização", () => {
    const { open } = setup();
    const win = open();
    win.show();
    win.unmaximize();
    win.show();
    expect(win.isMaximized()).toBe(false);
    expect(win.maximize).toHaveBeenCalledOnce();
  });

  it("mantém o monitor salvo quando ele continua conectado", () => {
    const bounds = { ...NORMAL, x: 2000 };
    const { open } = setup({ state: { maximized: false, bounds }, displays: [PRIMARY, SECONDARY] });
    expect(open().bounds).toEqual(bounds);
  });

  it("traz uma posição de monitor removido para dentro da área útil", () => {
    const { open } = setup({ state: { maximized: false, bounds: { ...NORMAL, x: 3000 } } });
    expect(open().bounds).toEqual({ ...NORMAL, x: 410, y: 160 });
  });

  it("o tamanho restaurável e os mínimos cabem numa tela pequena", () => {
    const { open } = setup({ displays: [{ workArea: { x: 0, y: 0, width: 800, height: 560 } }] });
    const win = open();
    expect(win.bounds).toEqual({ x: 0, y: 0, width: 800, height: 560 });
    expect(win.options.minWidth).toBe(800);
    expect(win.options.minHeight).toBe(560);
    win.show();
    expect(win.isMaximized()).toBe(true);
  });

  it("ampliar um estado abaixo do mínimo não empurra a janela para fora", () => {
    const { open } = setup({ state: { maximized: false, bounds: { x: 1400, y: 600, width: 500, height: 400 } } });
    expect(open().bounds).toEqual({ x: 1020, y: 440, width: 900, height: 600 });
  });

  it("ignora geometria inválida e usa a primeira abertura", () => {
    const { open } = setup({ state: { bounds: { ...NORMAL, x: "fora" } } });
    const win = open();
    win.show();
    expect(win.isMaximized()).toBe(true);
    expect(win.bounds).toEqual({ x: 275, y: 120, width: 1370, height: 800 });
  });

  it.each(["darwin", "linux"])("preserva a abertura de %s", (platform) => {
    const { open, store } = setup({ platform, state: { maximized: true, bounds: NORMAL } });
    const win = open();
    win.show();
    expect(win.options.width).toBe(1370);
    expect(win.options.height).toBe(800);
    expect(win.maximize).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
});
