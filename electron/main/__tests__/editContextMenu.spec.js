// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { attachEditContextMenu, buildEditContextMenuTemplate } = require("../editContextMenu.js");

function makeWin({ destroyed = false } = {}) {
  const webContents = new EventEmitter();
  webContents.cut = vi.fn();
  webContents.copy = vi.fn();
  webContents.paste = vi.fn();
  webContents.selectAll = vi.fn();
  return { webContents, isDestroyed: () => destroyed };
}

function makeMenu() {
  const popup = vi.fn();
  const buildFromTemplate = vi.fn(() => ({ popup }));
  return { Menu: { buildFromTemplate }, buildFromTemplate, popup };
}

function emitContextMenu(win, params) {
  win.webContents.emit("context-menu", {}, params);
}

function editableWithCopy() {
  return { isEditable: true, editFlags: { canCopy: true } };
}

describe("buildEditContextMenuTemplate", () => {
  it("monta Recortar/Copiar/Colar/Selecionar tudo quando o alvo é editável", () => {
    const items = buildEditContextMenuTemplate({
      isEditable: true,
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    });
    expect(items.map((item) => (item.type === "separator" ? "-" : item.label))).toEqual([
      "Recortar",
      "Copiar",
      "Colar",
      "-",
      "Selecionar tudo",
    ]);
    expect(items.filter((item) => item.type !== "separator").every((item) => item.enabled)).toBe(true);
  });

  it("desabilita itens que o Chromium não permite executar", () => {
    const items = buildEditContextMenuTemplate({
      isEditable: true,
      editFlags: { canCut: false, canCopy: true, canPaste: false, canSelectAll: true },
    });
    const enabled = Object.fromEntries(
      items.filter((item) => item.type !== "separator").map((item) => [item.label, item.enabled]),
    );
    expect(enabled).toEqual({ Recortar: false, Copiar: true, Colar: false, "Selecionar tudo": true });
  });

  it("não falha quando o evento vem sem editFlags", () => {
    const items = buildEditContextMenuTemplate({ isEditable: true });
    expect(items.filter((item) => item.type !== "separator").every((item) => !item.enabled)).toBe(true);
  });

  it("oferece só Copiar quando há seleção fora de campo editável", () => {
    expect(buildEditContextMenuTemplate({ isEditable: false, selectionText: "abc" })).toEqual([
      { label: "Copiar", enabled: true, action: "copy" },
    ]);
  });

  it("retorna null quando não há o que oferecer", () => {
    expect(buildEditContextMenuTemplate({ isEditable: false })).toBeNull();
    expect(buildEditContextMenuTemplate(undefined)).toBeNull();
  });
});

describe("attachEditContextMenu", () => {
  let warn;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("ignora janela sem webContents", () => {
    expect(() => attachEditContextMenu(null, {})).not.toThrow();
    expect(() => attachEditContextMenu({}, {})).not.toThrow();
  });

  it("abre o menu nativo na janela que recebeu o clique", () => {
    const win = makeWin();
    const { Menu, buildFromTemplate, popup } = makeMenu();
    attachEditContextMenu(win, Menu);
    emitContextMenu(win, { isEditable: true, editFlags: { canCopy: true } });
    expect(buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(popup).toHaveBeenCalledWith({ window: win });
  });

  it("executa os comandos direto no webContents da janela", () => {
    const win = makeWin();
    const { Menu, buildFromTemplate } = makeMenu();
    attachEditContextMenu(win, Menu);
    emitContextMenu(win, { isEditable: true, editFlags: { canCopy: true, canSelectAll: true } });
    const template = buildFromTemplate.mock.calls[0][0];
    template.find((item) => item.label === "Copiar").click();
    template.find((item) => item.label === "Selecionar tudo").click();
    expect(win.webContents.copy).toHaveBeenCalledTimes(1);
    expect(win.webContents.selectAll).toHaveBeenCalledTimes(1);
    expect(win.webContents.paste).not.toHaveBeenCalled();
  });

  it("não abre menu em área comum sem seleção", () => {
    const win = makeWin();
    const { Menu, buildFromTemplate } = makeMenu();
    attachEditContextMenu(win, Menu);
    emitContextMenu(win, { isEditable: false, selectionText: "" });
    expect(buildFromTemplate).not.toHaveBeenCalled();
  });

  it("não executa nada quando a janela já foi destruída", () => {
    const win = makeWin({ destroyed: true });
    const { Menu, buildFromTemplate } = makeMenu();
    attachEditContextMenu(win, Menu);
    emitContextMenu(win, { isEditable: true, editFlags: { canCopy: true } });
    buildFromTemplate.mock.calls[0][0].find((item) => item.label === "Copiar").click();
    expect(win.webContents.copy).not.toHaveBeenCalled();
  });

  it("contém falha do webContents sem derrubar o processo", () => {
    const win = makeWin();
    const { Menu, buildFromTemplate } = makeMenu();
    attachEditContextMenu(win, Menu);
    emitContextMenu(win, editableWithCopy());
    win.webContents.copy = () => {
      throw new Error("Object has been destroyed");
    };
    const click = buildFromTemplate.mock.calls[0][0].find((item) => item.label === "Copiar").click;
    expect(() => click()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("contém falha do próprio Menu", () => {
    const win = makeWin();
    const Menu = {
      buildFromTemplate: () => {
        throw new Error("boom");
      },
    };
    attachEditContextMenu(win, Menu);
    expect(() => emitContextMenu(win, editableWithCopy())).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
