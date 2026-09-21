import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * No Windows e no Linux os botões de janela são do sistema, e o Electron os
 * desenha por cima da systembar com uma altura própria (`titleBarOverlay`).
 * Essa altura mora em JS, no processo principal, e a da systembar mora em CSS:
 * são dois números que precisam ser o mesmo. Se a barra crescer e a faixa não,
 * os botões ficam presos no topo, fora do eixo do título, e nada avisa.
 *
 * O fundo da faixa também: precisa ser transparente. Uma cor sólida fica presa
 * ao valor da criação — o Electron não aplica alfa em `setTitleBarOverlay`
 * depois de a janela existir — e destoa do tema e do escurecimento dos modais,
 * que só o DOM alcança.
 *
 * O teste é de fonte porque os dois lados vivem em processos diferentes.
 */
describe("faixa dos botões nativos", () => {
  const windows = readFileSync("electron/main/windows.js", "utf8");
  const tokens = readFileSync("src/assets/styles/tokens.css", "utf8");
  const overlay = /const TITLEBAR_OVERLAY = \{([^}]*)\}/.exec(windows)?.[1] ?? "";

  it("tem a mesma altura da systembar", () => {
    const daBarra = /--lj-systembar-height:\s*(\d+)px/.exec(tokens)?.[1];
    const daFaixa = /height:\s*(\d+)/.exec(overlay)?.[1];

    expect(daBarra).toBeDefined();
    expect(daFaixa).toBe(daBarra);
  });

  it("tem fundo transparente", () => {
    expect(overlay).toMatch(/color:\s*"#[0-9a-fA-F]{6}00"/);
  });
});
