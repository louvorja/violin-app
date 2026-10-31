import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ records: [] as unknown[], categories: [] as unknown[] }));
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: async (table: string) => (table.endsWith(".category") ? db.categories : db.records),
  },
}));
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: true } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { captureException: vi.fn() } }));

const { ALL, entryOf, useNativeMediaLibrary } = await import("../useNativeMediaLibrary");

const rec = (id: string, path: string, categoryId?: string, addedAt = 1) => ({
  id,
  name: path.split("/").pop() || id,
  path,
  type: "image",
  addedAt,
  categoryId,
});

beforeEach(() => {
  db.records = [];
  db.categories = [];
  useNativeMediaLibrary().filter.value = ALL;
});

describe("registro da Biblioteca de Mídia → arquivo", () => {
  it("o caminho no disco vira um arquivo da biblioteca, com a extensão em minúsculas", () => {
    expect(entryOf(rec("1", "/fotos/Batismo.JPG"))).toMatchObject({
      name: "Batismo.JPG",
      path: "/fotos/Batismo.JPG",
      ext: "jpg",
      isDir: false,
    });
    expect(entryOf(rec("2", "C:\\Videos\\abertura.mp4"))?.ext).toBe("mp4");
  });

  it("guardado como bytes ou endereço não tem arquivo para abrir", () => {
    for (const path of ["blob:file:///abc", "data:image/png;base64,AA", "https://x/y.jpg", ""])
      expect(entryOf(rec("x", path))).toBeNull();
  });
});

describe("useNativeMediaLibrary", () => {
  it("lista o mais recente primeiro e filtra por categoria e pelos sem categoria", async () => {
    db.categories = [
      { id: "c2", name: "Santa Ceia" },
      { id: "c1", name: "Anúncios" },
    ];
    db.records = [
      rec("a", "/m/a.jpg", "c1", 1),
      rec("b", "/m/b.mp4", "c2", 3),
      rec("c", "/m/c.pdf", undefined, 2),
    ];
    const lib = useNativeMediaLibrary();
    await lib.load();

    expect(lib.categories.value.map((c) => c.name)).toEqual(["Anúncios", "Santa Ceia"]);
    expect(lib.entries.value.map((e) => e.name)).toEqual(["b.mp4", "c.pdf", "a.jpg"]);
    expect(lib.countOf("c1")).toBe(1);
    expect(lib.hasUncategorized.value).toBe(true);

    lib.filter.value = "";
    expect(lib.entries.value.map((e) => e.name)).toEqual(["c.pdf"]);
    lib.filter.value = "c2";
    expect(lib.entries.value.map((e) => e.name)).toEqual(["b.mp4"]);
  });

  it("conta o que só abre na Biblioteca de Mídia em vez de esconder calado", async () => {
    db.records = [rec("a", "/m/a.jpg"), rec("h", "blob:file:///heic")];
    const lib = useNativeMediaLibrary();
    await lib.load();

    expect(lib.entries.value).toHaveLength(1);
    expect(lib.unavailable.value).toBe(1);
    // A contagem da lateral bate com a grade.
    expect(lib.countOf(ALL)).toBe(1);
  });

  it("categoria apagada na Biblioteca: o filtro volta para todas", async () => {
    db.categories = [{ id: "c1", name: "Anúncios" }];
    db.records = [rec("a", "/m/a.jpg", "c1")];
    const lib = useNativeMediaLibrary();
    await lib.load();
    lib.filter.value = "c1";

    db.categories = [];
    await lib.load();

    expect(lib.filter.value).toBe(ALL);
    expect(lib.entries.value).toHaveLength(1);
  });
});
