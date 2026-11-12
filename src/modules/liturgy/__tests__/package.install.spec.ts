import { describe, expect, it, vi } from "vitest";
import { installPackage, IMPORTED_CATEGORY_ID, type InstallDeps } from "../package/install";
import type { PackageFile } from "../package/format";
import { DB_TABLE } from "@/constants/DbTables";
import type { LiturgyItem } from "@/types/Liturgy";

const item = (p: Omit<Partial<LiturgyItem>, "tipo"> & { tipo?: string }): LiturgyItem =>
  ({ id: "x", tipo: "anotacao", dir_info: "E", ...p }) as LiturgyItem;

const file = (
  source: PackageFile["source"],
  sourceId: string,
  name: string,
  content = "BYTES"
): PackageFile => ({ source, sourceId, name, mime: "", data: new Blob([content]) });

/** IndexedDB de mentira, por tabela. */
function fakeDeps(initial: Record<string, Record<string, unknown>[]> = {}) {
  const db = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [table, rows] of Object.entries(initial))
    db.set(table, new Map(rows.map((r) => [String(r.id), r])));
  const tableOf = (t: string) => {
    if (!db.has(t)) db.set(t, new Map());
    return db.get(t)!;
  };
  let n = 0;
  const liturgyFiles = new Map<string, string>();
  const deps: InstallDeps = {
    get: async (t, id) => tableOf(t).get(id),
    getAll: async (t) => [...tableOf(t).values()],
    put: async (t, r) => void tableOf(t).set(String(r.id), r),
    del: async (t, id) => void tableOf(t).delete(id),
    storeLiturgyFile: vi.fn(async (f: File) => {
      const id = `lf-${++n}`;
      liturgyFiles.set(id, f.name);
      return { dir: f.name, ref_id: id };
    }),
    removeLiturgyFile: vi.fn(async (id: string) => void liturgyFiles.delete(id)),
    importedCategoryName: "Importados",
    newId: () => `id-${++n}`,
    now: () => 1_700_000_000_000,
  };
  return { deps, db, tableOf, liturgyFiles };
}

describe("installPackage", () => {
  it("arquivo de mídia vira UM item da Biblioteca de Mídia; .slja fica arquivo da liturgia", async () => {
    const { deps, tableOf, liturgyFiles } = fakeDeps();
    const items = [
      item({ id: "a", tipo: "arquivo", item: "Abertura", ref_id: "r1", dir: "foto.jpg" }),
      item({ id: "b", tipo: "arquivo", item: "De novo", ref_id: "r1", dir: "foto.jpg" }),
      item({ id: "c", tipo: "arquivo", item: "Hino", dir: "C:\\hino.slja" }),
    ];
    const r = await installPackage(
      items,
      [file("liturgy", "r1", "foto.jpg"), file("liturgy", "c", "hino.slja")],
      deps
    );
    const media = [...tableOf(DB_TABLE.MEDIA_LIBRARY).values()];
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({
      name: "foto.jpg",
      type: "image",
      categoryId: IMPORTED_CATEGORY_ID,
    });
    expect(String(media[0].path)).toMatch(/^blob:/);
    expect(r.items[0]).toMatchObject({
      tipo: "biblioteca-midia",
      ref_id: media[0].id,
      subtipo: "image",
      item: "Abertura",
    });
    expect(r.items[1].ref_id).toBe(media[0].id);
    expect(r.items[2]).toMatchObject({
      tipo: "arquivo",
      ref_id: [...liturgyFiles.keys()][0],
      dir: "hino.slja",
    });
    expect([...liturgyFiles.values()]).toEqual(["hino.slja"]);
    expect(r.stored).toBe(2);
    // Categoria "Importados" criada uma vez.
    expect(tableOf(DB_TABLE.MEDIA_LIBRARY_CATEGORY).get(IMPORTED_CATEGORY_ID)).toMatchObject({
      name: "Importados",
      iconType: "icon",
    });
  });

  it("reaproveita a categoria Importados que já existe (pelo nome, sem acento/caixa)", async () => {
    const { deps, tableOf } = fakeDeps({
      [DB_TABLE.MEDIA_LIBRARY_CATEGORY]: [{ id: "cat-7", name: "IMPORTADOS" }],
    });
    await installPackage(
      [item({ id: "m", tipo: "biblioteca-midia", ref_id: "old" })],
      [file("media", "old", "video.mp4")],
      deps
    );
    expect([...tableOf(DB_TABLE.MEDIA_LIBRARY_CATEGORY).keys()]).toEqual(["cat-7"]);
    expect([...tableOf(DB_TABLE.MEDIA_LIBRARY).values()][0]).toMatchObject({
      categoryId: "cat-7",
      type: "video",
    });
  });

  it("Som de Fundo e Projeção de Fundo vão para as bibliotecas deles", async () => {
    const { deps, tableOf } = fakeDeps();
    const r = await installPackage(
      [item({ id: "s", tipo: "som-de-fundo", ref_id: "s-old" })],
      [
        file("background-sound", "s-old", "chuva.mp3"),
        file("background-projection", "p1", "fundo.jpg"),
        file("background-projection", "p2", "texto.txt"),
      ],
      deps
    );
    const sound = [...tableOf(DB_TABLE.BACKGROUND_SOUND_LIBRARY).values()][0];
    expect(sound).toMatchObject({ name: "chuva", fileName: "chuva.mp3" });
    expect(r.items[0].ref_id).toBe(sound.id);
    expect([...tableOf(DB_TABLE.BACKGROUND_PROJECTION_LIBRARY).values()]).toHaveLength(1);
    expect(r.unsupported).toEqual(["texto.txt"]);
  });

  it("item Projeção de Fundo aponta para o registro novo; a sobra entra uma vez", async () => {
    const { deps, tableOf } = fakeDeps();
    const r = await installPackage(
      [item({ id: "f", tipo: "projecao-de-fundo", item: "Fundo", ref_id: "p-old" })],
      [
        file("background-projection", "p-old", "fundo.jpg"),
        file("background-projection", "p-extra", "outro.jpg"),
      ],
      deps
    );
    const records = [...tableOf(DB_TABLE.BACKGROUND_PROJECTION_LIBRARY).values()];
    expect(records).toHaveLength(2);
    const used = records.find((x) => x.name === "fundo.jpg" || x.fileName === "fundo.jpg");
    expect(used).toBeTruthy();
    expect(r.items[0].ref_id).toBe(used!.id);
    expect(r.unsupported).toEqual([]);
  });

  it("referência que não veio e não existe aqui é limpa e avisada; a que existe fica", async () => {
    const { deps } = fakeDeps({ [DB_TABLE.MEDIA_LIBRARY]: [{ id: "local" }] });
    const r = await installPackage(
      [
        item({ id: "a", tipo: "biblioteca-midia", item: "Daqui", ref_id: "local" }),
        item({ id: "b", tipo: "biblioteca-midia", item: "De lá", ref_id: "longe" }),
        item({ id: "c", tipo: "arquivo", item: "Classic", dir: "arquivos/x.jpg", dir_info: "L" }),
      ],
      [],
      deps
    );
    expect(r.items[0].ref_id).toBe("local");
    expect(r.items[1].ref_id).toBeUndefined();
    expect(r.items[2].dir_info).toBe("E");
    expect(r.missing).toEqual(["De lá", "Classic"]);
  });

  it("YouTube entra na lista de Vídeos Online sem duplicar", async () => {
    const { deps, tableOf } = fakeDeps({
      [DB_TABLE.CUSTOM_ONLINE_VIDEOS]: [
        { id: "v0", url: "https://youtu.be/AAAAAAAAAAA", name: "Já tinha" },
      ],
    });
    const r = await installPackage(
      [
        item({
          id: "1",
          tipo: "video-online",
          item: "Abertura",
          url: "https://youtu.be/AAAAAAAAAAA",
        }),
        item({
          id: "2",
          tipo: "video-online",
          item: "Clipe",
          subitem: "Título do clipe",
          url: "https://www.youtube.com/watch?v=BBBBBBBBBBB",
        }),
        item({ id: "3", tipo: "site", item: "Mesmo clipe", url: "https://youtu.be/BBBBBBBBBBB" }),
        item({ id: "4", tipo: "site", item: "Igreja", url: "https://igreja.org" }),
      ],
      [],
      deps
    );
    const videos = [...tableOf(DB_TABLE.CUSTOM_ONLINE_VIDEOS).values()];
    expect(videos).toHaveLength(2);
    expect(videos[1]).toMatchObject({
      name: "Título do clipe",
      url: "https://www.youtube.com/watch?v=BBBBBBBBBBB",
      categoryId: IMPORTED_CATEGORY_ID,
    });
    expect(r.youtube).toEqual([{ id: "BBBBBBBBBBB", name: "Clipe" }]);
  });

  it("importar o mesmo pacote de novo reaproveita o que já está em Importados", async () => {
    const { deps, tableOf } = fakeDeps();
    const items = [item({ id: "m", tipo: "biblioteca-midia", ref_id: "old" })];
    const files = [file("media", "old", "video.mp4")];
    const first = await installPackage(items, files, deps);
    const second = await installPackage(items, files, deps);
    expect(tableOf(DB_TABLE.MEDIA_LIBRARY).size).toBe(1);
    expect(second.items[0].ref_id).toBe(first.items[0].ref_id);
    // Arquivo diferente com o mesmo nome entra como novo.
    await installPackage(items, [file("media", "old", "video.mp4", "OUTRO CONTEÚDO")], deps);
    expect(tableOf(DB_TABLE.MEDIA_LIBRARY).size).toBe(2);
  });

  it("rollback apaga tudo o que a importação criou", async () => {
    const { deps, tableOf, liturgyFiles } = fakeDeps();
    const r = await installPackage(
      [
        item({ id: "a", tipo: "arquivo", ref_id: "r1" }),
        item({ id: "b", tipo: "arquivo", ref_id: "r2" }),
        item({ id: "v", tipo: "video-online", url: "https://youtu.be/CCCCCCCCCCC" }),
      ],
      [file("liturgy", "r1", "foto.png"), file("liturgy", "r2", "hino.slja")],
      deps
    );
    expect(tableOf(DB_TABLE.MEDIA_LIBRARY).size).toBe(1);
    await r.rollback();
    expect(tableOf(DB_TABLE.MEDIA_LIBRARY).size).toBe(0);
    expect(tableOf(DB_TABLE.MEDIA_LIBRARY_CATEGORY).size).toBe(0);
    expect(tableOf(DB_TABLE.CUSTOM_ONLINE_VIDEOS).size).toBe(0);
    expect(tableOf(DB_TABLE.CUSTOM_ONLINE_VIDEOS_CATEGORIES).size).toBe(0);
    expect(liturgyFiles.size).toBe(0);
  });
});
