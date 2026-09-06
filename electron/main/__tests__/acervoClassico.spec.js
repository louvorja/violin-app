// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { candidatesFor, isSizeAcceptable } = require("../mediaRoots.js");

/**
 * O cenário que motivou todo o trabalho, com arquivos de verdade no disco:
 * alguém que já usa a versão clássica em Delphi tem o acervo inteiro baixado,
 * em .mp3 e .bmp, numa árvore com nomes de pasta em português. O catálogo novo
 * pede .opus e .jpg em `musics/<idioma>/`, `covers/` e `images/`.
 *
 * Sem isto, o app baixaria de novo a coletânea inteira — o impeditivo de
 * adoção que o Diego levantou.
 */

/** O que o resolvedor faz: primeiro candidato que existe e não está vazio. */
function resolver(rel, roots) {
  for (const c of candidatesFor(rel, roots)) {
    if (!existsSync(c.path)) continue;
    if (!statSync(c.path).isFile() || !isSizeAcceptable(statSync(c.path).size)) continue;
    return c;
  }
  return null;
}

describe("acervo da versão clássica no disco", () => {
  let base, nossa, classica, roots;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "louvorja-acervo-"));
    nossa = join(base, "dados", "files");
    classica = join(base, "LouvorJA", "config");

    mkdirSync(join(classica, "musicas", "Adoradores 5"), { recursive: true });
    mkdirSync(join(classica, "capas"), { recursive: true });
    mkdirSync(join(classica, "imagens"), { recursive: true });
    mkdirSync(join(nossa, "musics", "pt", "Novo"), { recursive: true });

    // Acervo antigo: formatos e nomes de pasta da versão Delphi.
    writeFileSync(join(classica, "musicas", "Adoradores 5", "01 Sublime Graca.mp3"), "audio");
    writeFileSync(join(classica, "capas", "1992.bmp"), "capa");
    writeFileSync(join(classica, "imagens", "45.bmp"), "letra");
    // Arquivo que só nós temos.
    writeFileSync(join(nossa, "musics", "pt", "Novo", "Faixa.opus"), "audio novo");

    roots = [
      { dir: nossa, layout: "modern" },
      { dir: classica, layout: "classic", lang: "pt" },
    ];
  });

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("toca o mp3 do acervo antigo quando o catálogo pede opus", () => {
    const achado = resolver("musics/pt/Adoradores 5/01 Sublime Graca.opus", roots);
    expect(achado).not.toBe(null);
    expect(achado.path.endsWith("01 Sublime Graca.mp3")).toBe(true);
    expect(achado.origin).toBe("classic");
  });

  it("encontra capa e imagem de letra em bmp", () => {
    expect(resolver("covers/1992.jpg", roots).origin).toBe("classic");
    expect(resolver("images/45.jpg", roots).origin).toBe("classic");
  });

  it("prefere o que é nosso, quando existe nos dois lugares", () => {
    mkdirSync(join(nossa, "capas"), { recursive: true });
    mkdirSync(join(nossa, "covers"), { recursive: true });
    writeFileSync(join(nossa, "covers", "1992.jpg"), "capa nova");
    const achado = resolver("covers/1992.jpg", roots);
    expect(achado.origin).toBe("own");
    expect(achado.path.startsWith(nossa)).toBe(true);
  });

  it("marca como nosso o que só existe na nossa pasta", () => {
    expect(resolver("musics/pt/Novo/Faixa.opus", roots).origin).toBe("own");
  });

  it("não encontra o que não existe em lugar nenhum — e aí sim vale baixar", () => {
    expect(resolver("musics/pt/Inexistente/X.opus", roots)).toBe(null);
  });

  it("não busca música de outro idioma no acervo clássico", () => {
    // A pasta `musicas/` do clássico é do idioma que a pessoa instalou; servir
    // a faixa portuguesa para um pedido em espanhol seria entregar áudio errado.
    expect(resolver("musics/es/Adoradores 5/01 Sublime Graca.opus", roots)).toBe(null);
  });

  it("ignora restos de download vazios e manda baixar de novo", () => {
    mkdirSync(join(nossa, "musics", "pt", "Truncado"), { recursive: true });
    writeFileSync(join(nossa, "musics", "pt", "Truncado", "Faixa.opus"), "");
    expect(resolver("musics/pt/Truncado/Faixa.opus", roots)).toBe(null);
  });

  it("nenhum candidato aponta para fora das raízes configuradas", () => {
    for (const c of candidatesFor("../../../etc/passwd", roots)) {
      expect(c.path.startsWith(nossa) || c.path.startsWith(classica)).toBe(true);
    }
    expect(candidatesFor("../../../etc/passwd", roots)).toEqual([]);
  });
});
