import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O `lang/` de um módulo é fundido na instância única do vue-i18n como
 * `modules.<id>.*`, e o `t` resolve por CAMINHO: `t("library.weekday_sunday")`
 * procura `library` → `weekday_sunday`.
 *
 * Uma chave escrita com ponto no próprio nome, no topo do arquivo, parece a
 * mesma coisa e nunca resolve. Não dá erro: o vue-i18n devolve o caminho, e a
 * tela mostra `library.weekday_sunday` onde deveria dizer "Domingo". Foi o que
 * aconteceu no seletor de dia do "Gerenciar liturgia" — as sete chaves estavam
 * lá, traduzidas, e nenhuma aparecia.
 *
 * A paridade entre os idiomas vem junto: chave que existe só em `pt` cai no
 * fallback e mostra português no meio de uma tela em espanhol.
 */

const MODULOS = "src/modules";

function modulosComLang(): { id: string; dir: string }[] {
  return readdirSync(MODULOS)
    .filter((nome) => {
      const caminho = join(MODULOS, nome, "lang");
      try {
        return statSync(caminho).isDirectory();
      } catch {
        return false;
      }
    })
    .map((id) => ({ id, dir: join(MODULOS, id, "lang") }));
}

function caminhos(objeto: unknown, prefixo = ""): string[] {
  if (!objeto || typeof objeto !== "object") return [prefixo];
  return Object.entries(objeto as Record<string, unknown>).flatMap(([chave, valor]) =>
    caminhos(valor, prefixo ? `${prefixo}.${chave}` : chave)
  );
}

function chavesComPonto(objeto: unknown, prefixo = ""): string[] {
  if (!objeto || typeof objeto !== "object") return [];
  return Object.entries(objeto as Record<string, unknown>).flatMap(([chave, valor]) => [
    ...(chave.includes(".") ? [prefixo ? `${prefixo}.${chave}` : chave] : []),
    ...chavesComPonto(valor, prefixo ? `${prefixo}.${chave}` : chave),
  ]);
}

const MODULOS_COM_LANG = modulosComLang();

describe("traduções de módulo", () => {
  it.each(MODULOS_COM_LANG)("$id não tem chave inalcançável (ponto no nome)", ({ dir }) => {
    for (const idioma of readdirSync(dir)) {
      const conteudo = JSON.parse(readFileSync(join(dir, idioma), "utf8"));
      expect(
        chavesComPonto(conteudo),
        `${dir}/${idioma}: o "t" resolve por caminho — aninhe a chave em vez de` +
          " escrever o ponto no nome, ou ela nunca será encontrada"
      ).toEqual([]);
    }
  });

  it.each(MODULOS_COM_LANG)("$id traduz as mesmas chaves em pt e es", ({ dir }) => {
    const pt = JSON.parse(readFileSync(join(dir, "pt.json"), "utf8"));
    const es = JSON.parse(readFileSync(join(dir, "es.json"), "utf8"));
    const soEmPt = caminhos(pt).filter((c) => !caminhos(es).includes(c));
    const soEmEs = caminhos(es).filter((c) => !caminhos(pt).includes(c));

    expect({ soEmPt, soEmEs }).toEqual({ soEmPt: [], soEmEs: [] });
  });
});
