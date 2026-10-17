import { describe, it, expect } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { Program } from "@/types/Presentation";
import { importLiturgy, kindFromPath, liturgyItem, programToLiturgy } from "../liturgy";

function ids() {
  let n = 0;
  return () => `id${++n}`;
}

const T = LiturgyItemTypeEnum;

describe("importar liturgia", () => {
  const announcements = [
    { id: "an1", title: "Semana da Família" },
    { id: "an2", title: "Batismo" },
    { id: "an3", title: "Ofertas" },
  ];

  const liturgy = [
    liturgyItem({ id: "solto", tipo: T.ANOTACAO, item: "Aviso inicial", duration: 2 }),
    liturgyItem({ id: "b1", tipo: T.BLOCO, item: "Abertura", time: "09:00" }),
    liturgyItem({ id: "m1", tipo: T.MUSICA, item: "Firme nas Promessas", id_music: 10, musica: 10, duration: 5 }),
    liturgyItem({ id: "f1", tipo: T.ARQUIVO, item: "Testemunho", dir: "C:\\Culto\\Testemunho.MP4", duration: 4 }),
    liturgyItem({ id: "b2", tipo: T.BLOCO, item: "Anúncios", time: "09:20" }),
    liturgyItem({ id: "n1", tipo: T.ANUNCIOS, item: "Anúncios da semana", anuncios_ids: ["an3", "an1"], duration: 6 }),
  ];

  it("vira sessões nos blocos e guarda o item de origem", () => {
    const result = importLiturgy(liturgy, { newId: ids(), defaultSessionLabel: "Geral", announcements });

    expect(result.plannedStart).toBe("09:00");
    expect(result.sessions.map((s) => s.label)).toEqual(["Geral", "Abertura", "Anúncios"]);

    const [geral, abertura] = result.sessions;
    expect(geral.items[0]).toMatchObject({ title: "Aviso inicial", kind: "note", plannedMinutes: 2 });
    expect(abertura.items.map((i) => i.kind)).toEqual(["music", "video"]);
    expect(abertura.items[0].source).toMatchObject({ tipo: T.MUSICA, id_music: 10 });
  });

  it("anúncios viram sub-itens na ordem de projeção", () => {
    const result = importLiturgy(liturgy, { newId: ids(), defaultSessionLabel: "Geral", announcements });
    const news = result.sessions[2].items[0];
    expect(news.kind).toBe("announcements");
    // A liturgia projeta na ordem global dos anúncios, não na da seleção.
    expect(news.children?.map((c) => c.ref)).toEqual(["an1", "an3"]);
  });

  it("anúncios sem seleção trazem todos", () => {
    const item = liturgyItem({ id: "x", tipo: T.ANUNCIOS, item: "Todos" });
    const result = importLiturgy([item], { newId: ids(), defaultSessionLabel: "Geral", announcements });
    expect(result.sessions[0].items[0].children).toHaveLength(3);
    expect(result.plannedStart).toBeNull();
  });

  it("classifica arquivos pela extensão", () => {
    expect(kindFromPath("/a/b.jpeg")).toBe("image");
    expect(kindFromPath("sermao.PPTX")).toBe("presentation");
    expect(kindFromPath("hino.opus")).toBe("audio");
    expect(kindFromPath("leia-me")).toBe("file");
  });
});

describe("salvar programa como liturgia", () => {
  const program: Program = {
    id: "2026-09-05",
    date: "2026-09-05",
    plannedStart: "09:00",
    createdAt: "",
    updatedAt: "",
    sessions: [
      {
        id: "s1",
        label: "Abertura",
        items: [
          {
            id: "i1",
            kind: "music",
            title: "Bendito Louvor",
            plannedMinutes: 6,
            source: liturgyItem({ id: "orig", tipo: T.MUSICA, id_music: 7, musica: 7, item: "Antigo" }),
          },
        ],
      },
      {
        id: "s2",
        label: "Palavra",
        items: [
          {
            id: "i2",
            kind: "bible",
            title: "Leitura bíblica",
            plannedMinutes: 2,
            bible: { reference: "João 3:16", text: "Porque Deus amou…", book_id: 43, chapter: 3, verses: [16] },
          },
        ],
      },
    ],
  };

  it("cada sessão vira bloco com horário e os itens voltam ao tipo de origem", () => {
    const items = programToLiturgy(program, ids());
    expect(items.map((i) => i.tipo)).toEqual([T.BLOCO, T.MUSICA, T.BLOCO, T.ANOTACAO]);
    expect(items[0]).toMatchObject({ item: "Abertura", time: "09:00" });
    expect(items[2]).toMatchObject({ item: "Palavra", time: "09:06" });
    expect(items[1]).toMatchObject({ item: "Bendito Louvor", id_music: 7, duration: 6, blocoId: items[0].id });
    expect(items[3]).toMatchObject({ item: "Leitura bíblica", subitem: "Porque Deus amou…" });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});
