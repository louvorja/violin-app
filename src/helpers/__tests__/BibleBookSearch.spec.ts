import { describe, expect, it } from "vitest";
import type { BibleBook } from "@/types/Bible";
import { buscarLivros, dividirOrdinal, interpretarReferencia } from "../BibleBookSearch";

/** Recorte real do pt_bible_book.json, já na ordem canônica. */
const livros: BibleBook[] = [
  { id_bible_book: 1, name: "Gênesis", abbreviation: "Gn", chapters: 50, keywords: "genesis" },
  { id_bible_book: 2, name: "Êxodo", abbreviation: "Ex", chapters: 40, keywords: "exodo" },
  { id_bible_book: 9, name: "I Samuel", abbreviation: "1Sm", chapters: 31, keywords: "i samuel" },
  { id_bible_book: 10, name: "II Samuel", abbreviation: "2Sm", chapters: 24, keywords: "ii samuel" },
  { id_bible_book: 11, name: "I Reis", abbreviation: "1Rs", chapters: 22, keywords: "i reis" },
  { id_bible_book: 12, name: "II Reis", abbreviation: "2Rs", chapters: 25, keywords: "ii reis" },
  { id_bible_book: 13, name: "I Crônicas", abbreviation: "1Cr", chapters: 29, keywords: "i cronicas" },
  { id_bible_book: 14, name: "II Crônicas", abbreviation: "2Cr", chapters: 36, keywords: "ii cronicas" },
  { id_bible_book: 18, name: "Jó", abbreviation: "Jó", chapters: 42, keywords: "jo" },
  { id_bible_book: 19, name: "Salmos", abbreviation: "Sl", chapters: 150, keywords: "salmos" },
  {
    id_bible_book: 22,
    name: "Cantares de Salomão",
    abbreviation: "Cn",
    chapters: 8,
    keywords: "cantares salomao canticos",
  },
  { id_bible_book: 23, name: "Isaías", abbreviation: "Is", chapters: 66, keywords: "isaias" },
  { id_bible_book: 43, name: "João", abbreviation: "Jo", chapters: 21, keywords: "joao" },
  { id_bible_book: 46, name: "I Coríntios", abbreviation: "1Co", chapters: 16, keywords: "i corintios" },
  { id_bible_book: 47, name: "II Coríntios", abbreviation: "2Co", chapters: 13, keywords: "ii corintios" },
  {
    id_bible_book: 52,
    name: "I Tessalonicenses",
    abbreviation: "1Ts",
    chapters: 5,
    keywords: "i tessalonicensses",
  },
  {
    id_bible_book: 53,
    name: "II Tessalonicenses",
    abbreviation: "2Ts",
    chapters: 3,
    keywords: "ii tessalonicenses",
  },
  { id_bible_book: 54, name: "I Timóteo", abbreviation: "1Tm", chapters: 6, keywords: "i timoteo" },
  { id_bible_book: 55, name: "II Timóteo", abbreviation: "2Tm", chapters: 4, keywords: "ii timoteo" },
  { id_bible_book: 60, name: "I Pedro", abbreviation: "1Pe", chapters: 5, keywords: "i pedro" },
  { id_bible_book: 61, name: "II Pedro", abbreviation: "2Pe", chapters: 3, keywords: "ii pedro" },
  { id_bible_book: 62, name: "I João", abbreviation: "1Jo", chapters: 5, keywords: "i joao" },
  { id_bible_book: 63, name: "II João", abbreviation: "2Jo", chapters: 1, keywords: "ii joao" },
  { id_bible_book: 64, name: "III João", abbreviation: "3Jo", chapters: 1, keywords: "iii joao" },
];

const nomes = (consulta: string) => buscarLivros(consulta, livros).map((l) => l.name);

describe("dividirOrdinal", () => {
  it("no nome, só o numeral seguido de separador conta (I Samuel × Isaías)", () => {
    expect(dividirOrdinal("I Samuel", true)).toEqual({ ordinal: 1, resto: "samuel" });
    expect(dividirOrdinal("II Samuel", true)).toEqual({ ordinal: 2, resto: "samuel" });
    expect(dividirOrdinal("III João", true)).toEqual({ ordinal: 3, resto: "joao" });
    expect(dividirOrdinal("Isaías", true)).toEqual({ ordinal: null, resto: "isaias" });
  });

  it("na consulta, o operador pode digitar colado", () => {
    expect(dividirOrdinal("isamuel")).toEqual({ ordinal: 1, resto: "samuel" });
    expect(dividirOrdinal("iisamuel")).toEqual({ ordinal: 2, resto: "samuel" });
    expect(dividirOrdinal("1 samuel")).toEqual({ ordinal: 1, resto: "samuel" });
    expect(dividirOrdinal("2pedro")).toEqual({ ordinal: 2, resto: "pedro" });
  });
});

describe("buscarLivros — ordinal", () => {
  const grupoI = [
    "I Samuel",
    "I Reis",
    "I Crônicas",
    "I Coríntios",
    "I Tessalonicenses",
    "I Timóteo",
    "I Pedro",
    "I João",
  ];

  it('"i" lista o grupo I primeiro e deixa Isaías para o fim', () => {
    const lista = nomes("i");
    expect(lista.slice(0, grupoI.length)).toEqual(grupoI);
    expect(lista).toContain("Isaías");
    expect(lista.indexOf("Isaías")).toBeGreaterThan(lista.indexOf("I João"));
    /* II e III também começam com "I", mas o ordinal pedido é o 1. */
    expect(lista).not.toContain("II Samuel");
    expect(lista).not.toContain("III João");
  });

  it('"1" é o mesmo grupo, sem letras soltas', () => {
    expect(nomes("1")).toEqual(grupoI);
    expect(nomes("1")).not.toContain("Isaías");
  });

  it('"ii" e "2" listam o grupo II', () => {
    for (const consulta of ["ii", "2"]) {
      expect(nomes(consulta)).toEqual([
        "II Samuel",
        "II Reis",
        "II Crônicas",
        "II Coríntios",
        "II Tessalonicenses",
        "II Timóteo",
        "II Pedro",
        "II João",
      ]);
    }
  });

  it("aceita romano e arábico, colado ou com espaço, no nome e na abreviação", () => {
    for (const consulta of ["isamuel", "1samuel", "1 samuel", "i samuel", "1s", "1sm"]) {
      expect(nomes(consulta), consulta).toContain("I Samuel");
    }
    for (const consulta of ["2samuel", "iisamuel", "ii samuel", "2s", "2sm"]) {
      expect(nomes(consulta), consulta).toContain("II Samuel");
    }
    for (const consulta of ["3joao", "iiijoao", "iii joao", "3jo"]) {
      expect(nomes(consulta), consulta).toEqual(["III João"]);
    }
    expect(nomes("2p")).toEqual(["II Pedro"]);
    expect(nomes("2pedro")).toContain("II Pedro");
    expect(nomes("iipedro")).toEqual(["II Pedro"]);
  });

  it('depois de ver a lista, o ordinal no fim também vale ("samuel1")', () => {
    expect(nomes("samuel1")).toEqual(["I Samuel"]);
    expect(nomes("samuel2")).toEqual(["II Samuel"]);
    expect(nomes("pedro2")).toEqual(["II Pedro"]);
    expect(nomes("joao3")).toEqual(["III João"]);
  });

  it("mais de um livro do grupo só se confirma quando resta um (1s × 1c)", () => {
    expect(nomes("1s")).toEqual(["I Samuel"]);
    expect(nomes("1c")).toEqual(["I Crônicas", "I Coríntios"]);
  });
});

describe("buscarLivros — nome sem o ordinal", () => {
  it('"samuel" acha os dois Samuel — o "I " do nome não esconde o livro', () => {
    expect(nomes("samuel")).toEqual(["I Samuel", "II Samuel"]);
  });

  it('"sal" continua sendo Salmos e não puxa Samuel', () => {
    const lista = nomes("sal");
    expect(lista[0]).toBe("Salmos");
    expect(lista).not.toContain("I Samuel");
    expect(lista).not.toContain("II Samuel");
    expect(nomes("salmos")).toEqual(["Salmos"]);
  });

  it('"pedro" e "joao" acham os grupos sem exigir o numeral', () => {
    expect(nomes("pedro")).toEqual(["I Pedro", "II Pedro"]);
    expect(nomes("joao")[0]).toBe("João");
    expect(nomes("joa")[0]).toBe("João");
  });

  it("nomes compostos e palavras dos dados", () => {
    expect(nomes("cantares")).toEqual(["Cantares de Salomão"]);
    expect(nomes("salomao")).toEqual(["Cantares de Salomão"]);
    expect(nomes("canticos")).toEqual(["Cantares de Salomão"]);
    expect(nomes("genesis")).toEqual(["Gênesis"]);
    expect(nomes("gn")).toEqual(["Gênesis"]);
    expect(nomes("ex")).toEqual(["Êxodo"]);
  });
});

describe("buscarLivros — exatos e bordas", () => {
  it('"is" continua sendo Isaías (o exato encerra a busca; não vira "I S...")', () => {
    expect(nomes("is")).toEqual(["Isaías"]);
    expect(nomes("isaias")).toEqual(["Isaías"]);
    expect(nomes("isaías")).toEqual(["Isaías"]);
    expect(nomes("ISAIAS")).toEqual(["Isaías"]);
  });

  it('"jo" devolve Jó e João, que compartilham a abreviação', () => {
    expect(nomes("jo")).toEqual(["Jó", "João"]);
  });

  it("consulta vazia ou sem correspondência", () => {
    expect(nomes("")).toEqual([]);
    expect(nomes("   ")).toEqual([]);
    expect(nomes("xyz")).toEqual([]);
  });
});

describe("interpretarReferencia — livro capítulo[:versículo]", () => {
  const referencia = (consulta: string) => {
    const r = interpretarReferencia(consulta, livros);
    return r ? { livro: r.book.name, capitulo: r.chapter, versiculo: r.verse } : null;
  };

  it("aceita romano e arábico, colado ou com espaço", () => {
    expect(referencia("1 samuel 3:16")).toEqual({
      livro: "I Samuel",
      capitulo: 3,
      versiculo: 16,
    });
    expect(referencia("ii pedro 1")).toEqual({ livro: "II Pedro", capitulo: 1, versiculo: null });
    expect(referencia("2pedro 1:1")).toEqual({ livro: "II Pedro", capitulo: 1, versiculo: 1 });
    expect(referencia("isamuel 3")).toEqual({ livro: "I Samuel", capitulo: 3, versiculo: null });
    expect(referencia("3joao 1")).toEqual({ livro: "III João", capitulo: 1, versiculo: null });
  });

  it("aceita as formas que a busca por texto já aceitava", () => {
    expect(referencia("joao 3:16")).toMatchObject({ livro: "João", capitulo: 3, versiculo: 16 });
    expect(referencia("joão 3 16")).toMatchObject({ livro: "João", capitulo: 3, versiculo: 16 });
    expect(referencia("sal 23")).toMatchObject({ livro: "Salmos", capitulo: 23, versiculo: null });
  });

  it("não trata texto livre nem número solto como referência", () => {
    expect(referencia("amor 3")).toBeNull();
    expect(referencia("1 3")).toBeNull();
    expect(referencia("joao")).toBeNull();
    expect(referencia("")).toBeNull();
  });
});
