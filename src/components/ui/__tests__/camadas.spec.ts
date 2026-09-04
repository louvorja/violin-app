import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * As camadas precisam empilhar na ordem em que se ANINHAM, não na ordem em que
 * parecem importantes. Um select dentro de um diálogo é caso corriqueiro — e
 * numerar o diálogo acima dos painéis deixava todo formulário em diálogo com o
 * menu invisível e inclicável. Este teste existe porque isso já aconteceu.
 */
const ui = readFileSync("src/assets/styles/ui.css", "utf8");

function token(nome: string): number {
  const m = ui.match(new RegExp(`--lj-z-${nome}:\\s*(\\d+)`));
  if (!m) throw new Error(`token --lj-z-${nome} não existe em ui.css`);
  return Number(m[1]);
}

describe("escala de camadas", () => {
  it("define os quatro níveis", () => {
    for (const n of ["dialog", "popup", "tooltip", "toast"]) {
      expect(token(n)).toBeGreaterThan(0);
    }
  });

  it("painel flutuante fica ACIMA do diálogo — select dentro de diálogo é comum", () => {
    expect(token("popup")).toBeGreaterThan(token("dialog"));
  });

  it("tooltip fica acima dos painéis, porque descreve o que está sob o ponteiro", () => {
    expect(token("tooltip")).toBeGreaterThan(token("popup"));
  });

  it("toast fica no topo, para avisar mesmo com diálogo modal aberto", () => {
    expect(token("toast")).toBeGreaterThan(token("tooltip"));
  });

  it("nenhum primitivo crava z-index numérico — todos usam a escala", () => {
    const arquivos = [
      "LjSelect",
      "LjMenu",
      "LjPopover",
      "LjCombobox",
      "LjTooltip",
      "LjToast",
      "LjDialog",
    ];
    const cravados: string[] = [];
    for (const nome of arquivos) {
      const src = readFileSync(`src/components/ui/${nome}.vue`, "utf8");
      for (const linha of src.split("\n")) {
        if (/z-index:\s*\d/.test(linha)) cravados.push(`${nome}: ${linha.trim()}`);
      }
    }
    expect(cravados).toEqual([]);
  });
});
