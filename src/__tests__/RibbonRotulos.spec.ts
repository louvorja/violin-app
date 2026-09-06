import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Todo grupo da ribbon precisa de nome traduzido nos dois idiomas.
 *
 * A montagem em `config/modules/index.ts` termina com
 * `groupTitles.get(id) ?? \`ribbon.groups.${id}\``. Esse fallback não falha nem
 * avisa: quando ninguém deu título ao grupo, o vue-i18n imprime a própria chave
 * como legenda. Foi assim que "ribbon.groups.files" foi parar na tela, entre
 * "Ações" e "Exibição", ao abrir a Projeção de Fundo.
 *
 * O defeito é invisível para quem escreve o manifesto — a ribbon monta, os
 * botões funcionam, e só a legenda sai errada, numa aba que talvez ninguém
 * abra durante o desenvolvimento.
 */

const PT = JSON.parse(readFileSync("src/lang/pt.json", "utf8"));
const ES = JSON.parse(readFileSync("src/lang/es.json", "utf8"));

function traduzida(dicionario: unknown, chave: string): boolean {
  return (
    chave.split(".").reduce<unknown>(
      (no, parte) => (no == null ? no : (no as Record<string, unknown>)[parte]),
      dicionario,
    ) !== undefined
  );
}

function arquivos(dir: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivos(caminho));
    else if (/\.(vue|ts)$/.test(nome) && !/\.spec\.ts$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

/** Nome da constante → valor. `HYMNAL = "hymnal"` → HYMNAL: "hymnal". */
function valoresDoEnum(): Record<string, string> {
  const fonte = readFileSync("src/enums/ModuleGroupEnum.ts", "utf8");
  const mapa: Record<string, string> = {};
  for (const m of fonte.matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) mapa[m[1]] = m[2];
  return mapa;
}

/**
 * Chaves de legenda que podem chegar à tela.
 *
 * São duas origens: a escrita à mão nos manifestos de ribbon contextual, e a
 * derivada — para cada grupo que uma categoria lista, o título de `groups.ts`
 * ou, na falta dele, o fallback.
 */
function chavesDeGrupo(): Map<string, string> {
  const enumeracao = valoresDoEnum();
  const chaves = new Map<string, string>();

  for (const caminho of arquivos("src")) {
    for (const m of readFileSync(caminho, "utf8").matchAll(/["'`](ribbon\.groups\.[a-z_]+)["'`]/g)) {
      chaves.set(m[1], caminho);
    }
  }

  const titulos = new Map<string, string>();
  const fonteGrupos = readFileSync("src/config/modules/ribbon/groups.ts", "utf8");
  for (const m of fonteGrupos.matchAll(/ModuleGroupEnum\.(\w+),\s*title:\s*path \+ "([^"]+)"/g)) {
    titulos.set(enumeracao[m[1]] ?? m[1], `ribbon.groups.${m[2]}`);
  }

  const fonteCategorias = readFileSync("src/config/modules/ribbon/categories.ts", "utf8");
  for (const m of fonteCategorias.matchAll(/groups:\s*\[([^\]]*)\]/g)) {
    for (const g of m[1].matchAll(/ModuleGroupEnum\.(\w+)/g)) {
      const id = enumeracao[g[1]] ?? g[1];
      chaves.set(titulos.get(id) ?? `ribbon.groups.${id}`, "categories.ts");
    }
  }

  return chaves;
}

describe("legendas dos grupos da ribbon", () => {
  it("todas existem em português e espanhol", () => {
    const faltando: string[] = [];
    for (const [chave, origem] of chavesDeGrupo()) {
      const idiomas = [
        !traduzida(PT, chave) && "pt",
        !traduzida(ES, chave) && "es",
      ].filter(Boolean);
      if (idiomas.length) faltando.push(`${chave} (${idiomas.join(", ")}) — usada em ${origem}`);
    }

    expect(
      faltando,
      "Sem tradução a legenda vira a própria chave na tela. Declare em src/lang/*.json:\n" +
        faltando.join("\n"),
    ).toEqual([]);
  });
});
