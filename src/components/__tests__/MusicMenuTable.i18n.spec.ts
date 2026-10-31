import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O `t` do MusicMenuTable é o global: chave de módulo precisa do caminho
 * inteiro (`modules.<id>.…`). Uma chave que não resolve não dá erro, a tela
 * mostra o caminho — foi o que o aviso de "música adicionada à playlist" fazia.
 */

const fonte = readFileSync("src/components/MusicMenuTable.vue", "utf8");
const usadas = [
  ...new Set([...fonte.matchAll(/(?<![\w.])t\(\s*["']([\w.]+)["']/g)].map((m) => m[1])),
];

/** O i18n global com cada módulo em `modules.<id>`, como o app monta. */
function traducoes(idioma: string): Record<string, unknown> {
  const lang = JSON.parse(readFileSync(`src/lang/${idioma}.json`, "utf8"));
  const modulo = (id: string) =>
    JSON.parse(readFileSync(`src/modules/${id}/lang/${idioma}.json`, "utf8"));
  return { ...lang, modules: { ...lang.modules, musics: modulo("musics") } };
}

function resolve(arvore: Record<string, unknown>, chave: string): unknown {
  return chave
    .split(".")
    .reduce<unknown>((no, parte) => (no as Record<string, unknown> | undefined)?.[parte], arvore);
}

describe("MusicMenuTable — traduções", () => {
  it("acha a chave do aviso da playlist", () => {
    expect(usadas).toContain("modules.musics.playlists.song_added");
  });

  it.each(["pt", "es"])("toda chave resolve em %s", (idioma) => {
    const arvore = traducoes(idioma);
    expect(usadas.filter((k) => typeof resolve(arvore, k) !== "string")).toEqual([]);
  });
});
