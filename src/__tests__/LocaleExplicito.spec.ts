import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `toLocaleDateString`, `toLocaleTimeString` e `toLocaleString` usam o locale do
 * SISTEMA quando ninguém passa uma tag — inclusive com `[]`, que parece
 * inofensivo e é o mesmo que não passar nada.
 *
 * O sintoma não aparece para quem desenvolve: numa máquina já configurada em
 * pt-BR o resultado sai certo, e o defeito só se revela onde o sistema está em
 * outro idioma. Num Ubuntu em inglês o módulo Relógio projetava "Sunday,
 * September 06, 2026" no telão com o app inteiro em português — e o seletor de
 * formato, na mesma tela, exibia a opção em português.
 *
 * A tag correta vem de `localeTag()` em `helpers/DateTime`, que traduz o idioma
 * do app (o `locale` do vue-i18n) para BCP47.
 */

const RAIZ = "src";

/**
 * Chamada sem argumento, com `[]`, ou com `[]` seguido de opções.
 *
 * Casada contra o arquivo inteiro, não linha a linha: o caso que motivou este
 * teste vinha quebrado em três linhas, com o `[]` sozinho na segunda.
 */
const SEM_LOCALE = /\.toLocale(Date|Time)?String\(\s*(\)|\[\s*\]\s*[,)])/g;

function arquivos(dir: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivos(caminho));
    } else if (/\.(vue|ts|js)$/.test(nome) && !/\.spec\.[tj]s$/.test(nome)) {
      achados.push(caminho);
    }
  }
  return achados;
}

describe("formatação de data e hora", () => {
  it("nunca cai no locale do sistema", () => {
    const infratores: string[] = [];

    for (const caminho of arquivos(RAIZ)) {
      const fonte = readFileSync(caminho, "utf8");
      for (const achado of fonte.matchAll(SEM_LOCALE)) {
        const linha = fonte.slice(0, achado.index).split("\n").length;
        infratores.push(`${caminho}:${linha}`);
      }
    }

    expect(
      infratores,
      "Passe localeTag(locale.value) de @/helpers/DateTime como primeiro argumento:\n" +
        infratores.join("\n"),
    ).toEqual([]);
  });
});
