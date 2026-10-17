/**
 * Tipo de campo declarado no manifesto = campo que o painel sabe desenhar.
 *
 * Quando um manifesto declara um `type` que o `FormatPanel` não mapeia, o
 * campo não some nem dá erro: cai no `FieldText` e aparece como **input de
 * texto solto**, sem faixa, enquanto o typecheck e o validador de manifestos
 * passam limpinhos. Foi assim que "Cantos arredondados" e "Espessura da borda"
 * chegaram ao painel como texto.
 *
 * O teste fecha o contrato na fonte — que é onde a falha nasce.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MODULES = "src/modules";
const PAINEL = "src/components/FormatPanel.vue";

/** Bloco entre chaves, contando profundidade — o `extrairBloco` do validador. */
function blocoDe(conteudo: string, abre: string): string {
  const inicio = conteudo.indexOf(abre);
  if (inicio < 0) return "";
  let profundidade = 0;
  for (let i = conteudo.indexOf("{", inicio); i < conteudo.length; i++) {
    if (conteudo[i] === "{") profundidade++;
    else if (conteudo[i] === "}") {
      profundidade--;
      if (profundidade === 0) return conteudo.slice(inicio, i);
    }
  }
  return "";
}

/** Tipos usados pelos manifests, na forma `{ tipo: [chaves] }`. */
function tiposUsadosNosManifestos(): Record<string, string[]> {
  const achados: Record<string, string[]> = {};
  for (const modulo of readdirSync(MODULES)) {
    const caminho = join(MODULES, modulo, "manifest.ts");
    let fonte: string;
    try {
      fonte = readFileSync(caminho, "utf8");
    } catch {
      continue;
    }
    const bloco = blocoDe(fonte, "customization:");
    if (!bloco) continue;
    for (const linha of bloco.split("\n")) {
      const chave = /^\s*([\w_]+):\s*\{/.exec(linha)?.[1];
      const tipo = /type:\s*"([^"]+)"/.exec(linha)?.[1];
      if (!chave || !tipo) continue;
      (achados[tipo] ||= []).push(`${modulo}.${chave}`);
    }
  }
  return achados;
}

/** Chaves do mapa `TYPE_TO_COMPONENT` do painel. */
function tiposMapeadosNoPainel(): string[] {
  const fonte = readFileSync(PAINEL, "utf8");
  const bloco = blocoDe(fonte, "TYPE_TO_COMPONENT");
  return [...bloco.matchAll(/^\s*"?([\w-]+)"?\s*:\s*Field/gm)].map((m) => m[1]);
}

describe("painel de formatação x manifestos", () => {
  const usados = tiposUsadosNosManifestos();
  const mapeados = new Set(tiposMapeadosNoPainel());

  it("o painel tem campos desenhados para os tipos usados", () => {
    /* Cada tipo volta com as chaves que o usou, para o erro dizer onde olhar. */
    const semCampo = Object.entries(usados)
      .filter(([tipo]) => !mapeados.has(tipo))
      .map(([tipo, chaves]) => `${tipo} (${chaves.slice(0, 3).join(", ")})`);

    expect(semCampo, "tipos sem campo no FormatPanel").toEqual([]);
  });

  it("os tipos novos da caixa de texto são numéricos, com faixa", () => {
    /* Raio e espessura precisam do FieldNumber: é ele que aplica min/max
       (raio admite 0, espessura vai até 20). */
    expect(mapeados.has("radius")).toBe(true);
    expect(mapeados.has("border-width")).toBe(true);
    expect(mapeados.has("opacity")).toBe(true);
  });
});
