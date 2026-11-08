import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { closeTabKeyScript } = require("../closeTabKey.js");

const key = (over = {}) => ({
  type: "keyDown",
  key: "w",
  control: false,
  meta: false,
  alt: false,
  shift: false,
  isAutoRepeat: false,
  ...over,
});

describe("⌘W / Ctrl+W nunca chega ao Fechar do menu padrão", () => {
  it("no Windows e no Linux o Ctrl+W vai para o Hotkeys como Ctrl", () => {
    for (const platform of ["win32", "linux"]) {
      const script = closeTabKeyScript(key({ control: true }), platform);
      expect(script).toContain('"ctrlKey":true');
      expect(script).not.toContain("metaKey");
    }
  });

  it("no Mac o ⌘W vai como Command, e o Ctrl+W segue o caminho comum", () => {
    expect(closeTabKeyScript(key({ meta: true }), "darwin")).toContain('"metaKey":true');
    expect(closeTabKeyScript(key({ control: true }), "darwin")).toBeNull();
  });

  it("com Caps Lock a letra chega maiúscula e ainda é a mesma tecla", () => {
    expect(closeTabKeyScript(key({ control: true, key: "W" }), "win32")).toContain("dispatchEvent");
  });

  it("segurar a tecla só cancela: não vai fechando aba atrás de aba até a janela", () => {
    expect(closeTabKeyScript(key({ control: true, isAutoRepeat: true }), "win32")).toBe("");
  });

  it("deixa passar o que não é esta tecla", () => {
    expect(closeTabKeyScript(key(), "win32")).toBeNull();
    expect(closeTabKeyScript(key({ control: true, shift: true }), "win32")).toBeNull();
    expect(closeTabKeyScript(key({ control: true, alt: true }), "win32")).toBeNull();
    expect(closeTabKeyScript(key({ control: true, key: "q" }), "win32")).toBeNull();
    expect(closeTabKeyScript(key({ control: true, type: "keyUp" }), "win32")).toBeNull();
  });
});
