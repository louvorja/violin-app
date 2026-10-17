import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/*
 * Ordem das camadas da tela de fundo.
 *
 * Não dá para provar isto montando o componente: o jsdom não resolve o CSS de um
 * SFC com escopo, e a falha aparece como `NaN` — o mesmo silêncio de um z-index
 * errado. Então o teste lê a folha de estilo da própria view e confere a ordem,
 * que é a regra de verdade.
 *
 * A ordem importa porque, com a tela de fundo ligada, NADA abre janela: o vídeo
 * também é uma camada. O utilitário era uma janela por cima de tudo, então
 * ganhou z-index alto "por causa disso" — e passou a tapar o vídeo, que é a
 * coisa principal do telão. O defeito só apareceria para quem está projecando.
 *
 * A ordem vigente: arquivo > avisos > utilitário > slides.
 */
const fonte = readFileSync("src/views/BackgroundProjection.vue", "utf8");

/** `z-index` da regra CSS de um seletor de classe. */
function zIndexDe(seletor: string): number {
  const achado = fonte.match(new RegExp(`\\.${seletor}\\s*\\{[^}]*?z-index:\\s*(-?\\d+)`, "s"));
  if (!achado) throw new Error(`z-index de .${seletor} não encontrado`);
  return Number(achado[1]);
}

const ARQUIVO = "file-projection";
const AVISOS = "layer-avisos";
const UTILITARIO = "layer-utilitario";
const SLIDES = "layer-projection";

describe("ordem das camadas da projeção de fundo", () => {
  it("o utilitário fica abaixo do arquivo e dos avisos", () => {
    /* O vídeo e o PDF são a coisa principal do telão: nenhum utilitário os tapa. */
    expect(zIndexDe(ARQUIVO)).toBeGreaterThan(zIndexDe(UTILITARIO));
    expect(zIndexDe(AVISOS)).toBeGreaterThan(zIndexDe(UTILITARIO));
  });

  it("os avisos continuam acima do arquivo, como a janela inteira fazia", () => {
    expect(zIndexDe(AVISOS)).toBeGreaterThan(zIndexDe(ARQUIVO));
  });

  it("o utilitário fica acima dos slides, não abaixo", () => {
    /* Empilhamento igual ao da música, e depois dela no documento. */
    expect(zIndexDe(UTILITARIO)).toBe(zIndexDe(SLIDES));
    expect(fonte.indexOf(`class="layer-utilitario"`)).toBeGreaterThan(
      fonte.indexOf(`class="layer-projection"`)
    );
  });
});
