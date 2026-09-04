import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ICONS } from "../Icons";

/**
 * Todo nome "mdi-*" que o app usa tem de existir no acervo instalado.
 *
 * Este teste existe porque seis não existiam — e dois eram renderizados: o
 * cabeçalho do diálogo de inicialização e todo item de liturgia do tipo
 * overlay apareciam com um espaço vazio no lugar do ícone. Nada acusava:
 * o webfont simplesmente não desenha nada para uma classe que não conhece.
 */
const css = readFileSync("node_modules/@mdi/font/css/materialdesignicons.css", "utf8");
const existentes = new Set([...css.matchAll(/^\.(mdi-[a-z0-9-]+)::before/gm)].map((m) => m[1]));

function achataIcons(obj: Record<string, unknown>, prefixo = ""): [string, string][] {
  const saida: [string, string][] = [];
  for (const [chave, valor] of Object.entries(obj)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    if (typeof valor === "string") saida.push([caminho, valor]);
    else if (valor && typeof valor === "object")
      saida.push(...achataIcons(valor as Record<string, unknown>, caminho));
  }
  return saida;
}

describe("catálogo de ícones", () => {
  it("o acervo instalado foi lido", () => {
    expect(existentes.size).toBeGreaterThan(7000);
  });

  it("toda constante ICONS.* aponta para um ícone que existe", () => {
    const quebrados = achataIcons(ICONS as unknown as Record<string, unknown>)
      .filter(([, valor]) => valor.startsWith("mdi-") && !existentes.has(valor))
      .map(([caminho, valor]) => `ICONS.${caminho} = ${valor}`);
    expect(quebrados).toEqual([]);
  });

  it("nenhum nome mdi- solto no código aponta para ícone inexistente", () => {
    // Cobre o que não passa pelo Icons.ts — helpers, manifests e templates.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const saida = execSync(
      `grep -rhoE '"mdi-[a-z0-9-]+"' src --include='*.vue' --include='*.ts' --include='*.js' || true`,
      { encoding: "utf8" }
    );
    const usados = [...new Set(saida.split("\n").map((l) => l.trim().replace(/"/g, "")))].filter(
      Boolean
    );
    expect(usados.filter((n) => !existentes.has(n))).toEqual([]);
  });
});
