// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { join } from "path";

const require = createRequire(import.meta.url);
const {
  toClassicRel,
  candidatesFor,
  classicSearchDirs,
  joinDentroDe,
  isSizeAcceptable,
} = require("../mediaRoots.js");

/**
 * Muita gente já tem o acervo inteiro no disco, baixado pela versão clássica em
 * Delphi, que guarda os mesmos arquivos com outros nomes de pasta e em .mp3/.bmp.
 * Este módulo é o que traduz um caminho do banco para o lugar equivalente lá.
 *
 * A parte pura existe separada porque o processo principal não tem mock de `fs`
 * nos testes: se o mapeamento morasse junto do acesso a disco, não daria para
 * cobrir justamente a regra que erra em silêncio — servir o arquivo errado.
 */
describe("toClassicRel", () => {
  it("traduz as pastas de capa e imagem", () => {
    expect(toClassicRel("covers/1992.jpg")).toBe("capas/1992.jpg");
    expect(toClassicRel("images/lyric/45.jpg")).toBe("imagens/lyric/45.jpg");
  });

  it("traduz música quando conhece o idioma da instalação", () => {
    expect(toClassicRel("musics/pt/Album/Faixa.opus", "pt")).toBe("musicas/Album/Faixa.opus");
  });

  it("não traduz música de outro idioma", () => {
    // O clássico tem uma pasta `musicas/` só, da instalação que o usuário fez.
    // Mapear espanhol para ela serviria a faixa portuguesa de mesmo nome.
    expect(toClassicRel("musics/es/Album/Faixa.opus", "pt")).toBe(null);
  });

  it("sem idioma, não arrisca palpite em música", () => {
    expect(toClassicRel("musics/pt/Album/Faixa.opus", null)).toBe(null);
  });

  it("devolve null para o que não existe na estrutura antiga", () => {
    expect(toClassicRel("bundles/libras/x.zip", "pt")).toBe(null);
    expect(toClassicRel("")).toBe(null);
  });

  it("ignora a barra inicial do banco", () => {
    expect(toClassicRel("/covers/7.jpg")).toBe("capas/7.jpg");
  });
});

describe("candidatesFor", () => {
  const RAIZES = [
    { dir: "/dados/files" },
    { dir: "/classico/config", layout: "classic", lang: "pt" },
  ];

  it("põe a pasta própria na frente da clássica", () => {
    const c = candidatesFor("musics/pt/A/B.opus", RAIZES);
    expect(c[0]).toEqual({ path: join("/dados/files", "musics/pt/A/B.opus"), origin: "own" });
    expect(c.map((x) => x.origin)).toEqual(["own", "own", "classic", "classic"]);
  });

  it("oferece o formato antigo dentro de cada raiz", () => {
    const c = candidatesFor("musics/pt/A/B.opus", RAIZES);
    expect(c.map((x) => x.path)).toEqual([
      join("/dados/files", "musics/pt/A/B.opus"),
      join("/dados/files", "musics/pt/A/B.mp3"),
      join("/classico/config", "musicas/A/B.opus"),
      join("/classico/config", "musicas/A/B.mp3"),
    ]);
  });

  it("marca a origem, que é o que a interface usa para não mentir no botão remover", () => {
    const c = candidatesFor("covers/9.jpg", RAIZES);
    expect(c.filter((x) => x.origin === "classic").map((x) => x.path)).toEqual([
      join("/classico/config", "capas/9.jpg"),
      join("/classico/config", "capas/9.jpeg"),
      join("/classico/config", "capas/9.bmp"),
    ]);
  });

  it("descarta candidato que escapa da própria raiz", () => {
    expect(candidatesFor("../../etc/senha.jpg", RAIZES)).toEqual([]);
  });

  it("pula a raiz clássica quando o caminho não existe lá", () => {
    const c = candidatesFor("bundles/x.zip", RAIZES);
    expect(c.every((x) => x.origin === "own")).toBe(true);
  });

  it("sem raízes, não devolve nada", () => {
    expect(candidatesFor("covers/1.jpg", [])).toEqual([]);
  });
});

describe("classicSearchDirs", () => {
  it("no Windows procura nos dois Program Files", () => {
    const dirs = classicSearchDirs({ platform: "win32" });
    expect(dirs.some((d) => d.includes("Program Files (x86)"))).toBe(true);
    expect(dirs.length).toBeGreaterThan(1);
  });

  it("fora do Windows procura dentro do disco emulado do Wine", () => {
    const dirs = classicSearchDirs({ platform: "darwin", home: "/Users/x" });
    expect(dirs.some((d) => d.includes(".wine/drive_c") || d.includes(".wine\\drive_c"))).toBe(true);
    expect(dirs.some((d) => d.includes("CrossOver"))).toBe(true);
  });

  it("sem home, não inventa caminho", () => {
    expect(classicSearchDirs({ platform: "linux", home: "" })).toEqual([]);
  });
});

/**
 * Mesma conta que decide onde é seguro GRAVAR. É a linha que separa "o app
 * escreve na pasta dele" de "o app escreve na instalação de outro programa",
 * então ela tem teste próprio.
 */
describe("joinDentroDe", () => {
  it("resolve caminho normal", () => {
    expect(joinDentroDe("/dados/files", "covers/1.jpg")).toBe(join("/dados/files", "covers/1.jpg"));
    expect(joinDentroDe("/dados/files", "/covers/1.jpg")).toBe(join("/dados/files", "covers/1.jpg"));
  });

  it("recusa o que sobe de pasta", () => {
    expect(joinDentroDe("/dados/files", "../fora.mp3")).toBe(null);
    expect(joinDentroDe("/dados/files", "a/../../fora.mp3")).toBe(null);
  });

  it("recusa vazio e raiz ausente", () => {
    expect(joinDentroDe("/dados/files", "")).toBe(null);
    expect(joinDentroDe("", "covers/1.jpg")).toBe(null);
  });

  it("aceita subir e voltar sem sair", () => {
    expect(joinDentroDe("/dados/files", "covers/../covers/1.jpg")).toBe(
      join("/dados/files", "covers/1.jpg")
    );
  });
});

/**
 * O catálogo do servidor não informa tamanho, então `expectedSize` chega 0 em
 * todas as chamadas reais. Sem tratar esse caso, "tem tamanho certo" virava
 * "existe", e um arquivo de 0 byte — resto de download interrompido — passava
 * por acervo baixado: o álbum ficava com o visto e a música não tocava.
 */
describe("isSizeAcceptable", () => {
  it("sem tamanho esperado, recusa arquivo vazio", () => {
    expect(isSizeAcceptable(0, 0)).toBe(false);
    expect(isSizeAcceptable(1, 0)).toBe(true);
  });

  it("trata a ausência do parâmetro como ausência de tamanho esperado", () => {
    expect(isSizeAcceptable(0)).toBe(false);
    expect(isSizeAcceptable(4096)).toBe(true);
  });

  it("com tamanho esperado, aceita a partir dele", () => {
    expect(isSizeAcceptable(999, 1000)).toBe(false);
    expect(isSizeAcceptable(1000, 1000)).toBe(true);
  });

  it("aceita arquivo maior que o esperado, que é o caso do mp3 no lugar do opus", () => {
    expect(isSizeAcceptable(4_000_000, 1_200_000)).toBe(true);
  });
});
