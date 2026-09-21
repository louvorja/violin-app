import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O wallpaper da projeção de arquivo só aparece onde o conteúdo não chega: sem nada para mostrar, ou
 * com um conteúdo menor que a janela. Um padding no contêiner raiz o transformava numa moldura fixa
 * ao redor de tudo — o retorno mostrava 24 px de azul em volta do player do YouTube.
 *
 * O teste é de fonte porque o jsdom não calcula layout.
 */
function bloco(fonte: string, seletor: string): string {
  const estilo = fonte.slice(fonte.indexOf("<style"));
  const inicio = estilo.indexOf(`${seletor} {`);
  expect(inicio, `${seletor} não encontrado`).toBeGreaterThanOrEqual(0);
  return estilo.slice(inicio, estilo.indexOf("}", inicio));
}

describe("fundo da projeção de arquivo", () => {
  it.each([
    ["src/views/FileProjection.vue", ".file-projection"],
    ["src/views/FileProjectionReturn.vue", ".return-root"],
  ])("%s: o contêiner raiz não tem padding nem margem", (arquivo, seletor) => {
    const css = bloco(readFileSync(arquivo, "utf8"), seletor);
    expect(css).toMatch(/width: 100vw/);
    expect(css).not.toMatch(/\b(padding|margin)\b/);
  });
});
