import { describe, expect, it } from "vitest";
import {
  carriesFile,
  collectFiles,
  countExport,
  nameWithExtension,
  DEFAULT_EXPORT_OPTIONS,
  type CollectDeps,
  type LibraryRecord,
} from "../package/collect";
import { DB_TABLE } from "@/constants/DbTables";
import type { LiturgyItem } from "@/types/Liturgy";

const item = (p: Omit<Partial<LiturgyItem>, "tipo"> & { tipo?: string }): LiturgyItem =>
  ({ id: "x", tipo: "anotacao", ...p }) as LiturgyItem;

function deps(tables: Record<string, LibraryRecord[]>, disk: Record<string, string> = {}) {
  const reads: string[] = [];
  const d: CollectDeps = {
    get: async (table, id) => tables[table]?.find((r) => r.id === id),
    getAll: async (table) => tables[table] || [],
    readLiturgyFile: async (id) =>
      id === "lit-1" ? { name: "hino.slja", data: new Blob(["SLJA"]) } : null,
    readLocal: async (path) => {
      reads.push(path);
      return disk[path] ? new Blob([disk[path]], { type: "video/mp4" }) : null;
    },
  };
  return { d, reads };
}

const tables = {
  [DB_TABLE.MEDIA_LIBRARY]: [
    {
      id: "m1",
      name: "Abertura",
      path: "blob:x",
      data: new TextEncoder().encode("IMG").buffer,
      mime: "image/png",
    },
    { id: "m2", name: "Vídeo.mp4", path: "C:\\Videos\\Vídeo.mp4" },
  ],
  [DB_TABLE.BACKGROUND_SOUND_LIBRARY]: [
    {
      id: "s1",
      name: "Chuva",
      fileName: "chuva.mp3",
      path: "blob:y",
      data: new TextEncoder().encode("MP3").buffer,
      mime: "audio/mpeg",
    },
  ],
  [DB_TABLE.BACKGROUND_PROJECTION_LIBRARY]: [
    {
      id: "p1",
      name: "fundo.jpg",
      path: "blob:z",
      data: new TextEncoder().encode("BG").buffer,
      mime: "image/jpeg",
    },
    { id: "p2", name: "fundo2.jpg", path: "blob:w" },
  ],
} as Record<string, LibraryRecord[]>;

const liturgy = [
  item({ id: "i1", tipo: "arquivo", item: "Hino", ref_id: "lit-1", dir: "hino.slja" }),
  item({ id: "i2", tipo: "arquivo", item: "Vídeo do disco", dir: "D:\\culto\\abertura.mp4" }),
  item({ id: "i3", tipo: "arquivo", item: "Site", dir: "https://a.b/c.pdf" }),
  item({ id: "i4", tipo: "biblioteca-midia", item: "Foto", ref_id: "m1" }),
  item({ id: "i5", tipo: "biblioteca-midia", item: "Foto de novo", ref_id: "m1" }),
  item({ id: "i6", tipo: "biblioteca-midia", item: "Vídeo", ref_id: "m2" }),
  item({ id: "i7", tipo: "som-de-fundo", item: "Chuva", ref_id: "s1" }),
  item({ id: "i8", tipo: "biblioteca-midia", item: "Apagada", ref_id: "sumiu" }),
  item({ id: "i9", tipo: "anuncios", item: "Avisos" }),
  item({ id: "i10", tipo: "musica", item: "Minha canção", ref_id: "c1", musica: -2 }),
];

describe("carriesFile", () => {
  it("arquivo do disco ou guardado no app vai; endereço da internet não", () => {
    expect(liturgy.map(carriesFile).slice(0, 3)).toEqual([true, true, false]);
    expect(carriesFile(item({ tipo: "anotacao" }))).toBe(false);
  });
});

describe("nameWithExtension", () => {
  it("devolve a extensão que o operador tirou ao renomear", () => {
    expect(nameWithExtension("Abertura", "blob:x", "image/png")).toBe("Abertura.png");
    expect(nameWithExtension("Abertura", "C:\\v\\a.MP4", "")).toBe("Abertura.MP4");
    expect(nameWithExtension("foto.jpg", "", "")).toBe("foto.jpg");
  });
});

describe("contagem da janela de exportação", () => {
  it("conta cada origem uma vez e a biblioteca inteira de Projeção de Fundo", async () => {
    const { d } = deps(tables);
    expect(await countExport(liturgy, d.getAll)).toEqual({
      liturgy: 2,
      media: 3,
      backgroundSound: 1,
      backgroundProjection: 2,
    });
  });
});

describe("collectFiles", () => {
  it("leva arquivos da liturgia e das bibliotecas usadas, uma vez cada", async () => {
    const { d, reads } = deps(tables, {
      "D:\\culto\\abertura.mp4": "MP4",
      "C:\\Videos\\Vídeo.mp4": "VID",
    });
    const r = await collectFiles(liturgy, DEFAULT_EXPORT_OPTIONS, d);
    expect(r.files.map((f) => `${f.source}:${f.sourceId}:${f.name}`)).toEqual([
      "liturgy:lit-1:hino.slja",
      "liturgy:i2:abertura.mp4",
      "media:m1:Abertura.png",
      "media:m2:Vídeo.mp4",
      "background-sound:s1:chuva.mp3",
    ]);
    // O caminho do item que já é endereço da internet não é lido.
    expect(reads).not.toContain("https://a.b/c.pdf");
    expect(r.missing).toEqual(["Apagada"]);
    expect(r.localOnly).toEqual(["Avisos", "Minha canção"]);
  });

  it("biblioteca desmarcada não vai e o item é avisado", async () => {
    const { d } = deps(tables);
    const r = await collectFiles(
      liturgy,
      { media: false, backgroundSound: false, backgroundProjection: false },
      d
    );
    expect(r.files.map((f) => f.source)).toEqual(["liturgy"]);
    expect(r.localOnly).toEqual(
      expect.arrayContaining(["Foto", "Foto de novo", "Vídeo", "Chuva", "Apagada"])
    );
    // Arquivo do disco que não deu para ler vai para os ausentes.
    expect(r.missing).toEqual(["Vídeo do disco"]);
  });

  it("Projeção de Fundo inteira, quando marcada; registro sem bytes fica de fora", async () => {
    const { d } = deps(tables);
    const r = await collectFiles([], { ...DEFAULT_EXPORT_OPTIONS, backgroundProjection: true }, d);
    expect(r.files.map((f) => `${f.source}:${f.sourceId}`)).toEqual(["background-projection:p1"]);
  });
});
