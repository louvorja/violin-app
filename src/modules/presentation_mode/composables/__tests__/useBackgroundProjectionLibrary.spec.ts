import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";

const { getAll } = vi.hoisted(() => ({ getAll: vi.fn() }));

vi.mock("@/helpers/IndexedDB", () => ({ default: { getAll } }));
vi.mock("@/helpers/BackgroundProjectionPlayback", () => ({
  resolveBackgroundProjectionUrl: (file: { path?: string; data?: unknown; mime?: string }) =>
    file.data && file.mime ? `blob:${file.mime}` : file.path || "",
}));

import {
  BACKGROUND_PROJECTION_ALL,
  BACKGROUND_PROJECTION_UNCATEGORIZED,
  backgroundProjectionName,
  useBackgroundProjectionLibrary,
  type BackgroundProjectionFile,
} from "../useBackgroundProjectionLibrary";

const validRecords: BackgroundProjectionFile[] = [
  { id: "p2", name: "Mar", path: "/mar.mp4", type: "video", categoryId: "c1", order: 2 },
  { id: "p1", name: "", path: "/culto.jpg", type: "image", categoryId: "", order: 1 },
  {
    id: "p3",
    name: "Sem arquivo",
    path: "/sumiu.jpg",
    type: "image",
    categoryId: "apagada",
    order: 3,
  },
];

const records: unknown[] = [...validRecords, { id: "p4", name: "Inválido", type: "pdf", order: 4 }];

const categories = [
  { id: "c1", name: "Natureza", color: "#3a7" },
  { id: "c2", name: "Culto" },
];

describe("biblioteca de projeção de fundo", () => {
  beforeEach(() => {
    getAll.mockReset();
    getAll.mockImplementation(async (table: string) => {
      if (table === DB_TABLE.BACKGROUND_PROJECTION_LIBRARY) return records;
      if (table === DB_TABLE.BACKGROUND_PROJECTION_CATEGORIES) return categories;
      return [];
    });
  });

  it("carrega imagens e vídeos, ordena e ignora registros inválidos", async () => {
    const bgp = useBackgroundProjectionLibrary();
    bgp.filter.value = BACKGROUND_PROJECTION_ALL;
    await bgp.load();

    expect(bgp.records.value.map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
    expect(bgp.filtered.value).toHaveLength(3);
    expect(bgp.hasUncategorized.value).toBe(true);
    expect(bgp.countOf(BACKGROUND_PROJECTION_UNCATEGORIZED)).toBe(2);
    expect(bgp.displayName(validRecords[1])).toBe("p1");
  });

  it("filtra por categoria e mantém o filtro válido", async () => {
    const bgp = useBackgroundProjectionLibrary();
    await bgp.load();

    bgp.filter.value = "c1";
    expect(bgp.filtered.value.map((r) => r.id)).toEqual(["p2"]);

    bgp.filter.value = "categoria-que-sumiu";
    await bgp.load();
    expect(bgp.filter.value).toBe(BACKGROUND_PROJECTION_ALL);
  });

  it("resolve a miniatura da imagem e reaproveita a URL criada", async () => {
    const bgp = useBackgroundProjectionLibrary();
    await bgp.load();

    const image = bgp.records.value.find((r) => r.id === "p1")!;
    expect(bgp.thumbOf(image)).toBe("/culto.jpg");
    expect(bgp.thumbOf(image)).toBe("/culto.jpg");

    const video = bgp.records.value.find((r) => r.id === "p2")!;
    expect(bgp.thumbOf(video)).toBe("");
    bgp.disposeThumbs();
  });

  it("recria a miniatura a partir dos bytes quando o thumb é um blob morto", async () => {
    const bgp = useBackgroundProjectionLibrary();
    await bgp.load();

    const image = {
      id: "p9",
      name: "Bytes",
      path: "bytes.jpg",
      type: "image" as const,
      thumb: "blob:antigo",
      data: new ArrayBuffer(3),
      mime: "image/jpeg",
    };
    expect(bgp.thumbOf(image)).toBe("blob:image/jpeg");
    bgp.disposeThumbs();
  });

  it("não usa os bytes do vídeo como miniatura", async () => {
    const bgp = useBackgroundProjectionLibrary();
    await bgp.load();

    const video = {
      id: "p10",
      name: "Vídeo",
      path: "video.mp4",
      type: "video" as const,
      thumb: "blob:antigo",
      data: new ArrayBuffer(3),
      mime: "video/mp4",
    };
    expect(bgp.thumbOf(video)).toBe("");
    bgp.disposeThumbs();
  });

  it("recria o ícone da categoria a partir dos bytes e reutiliza a URL", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:categoria");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const bgp = useBackgroundProjectionLibrary();
    await bgp.load();

    const category = {
      id: "c9",
      name: "Com imagem",
      iconType: "image" as const,
      icon: "blob:antigo",
      iconData: new ArrayBuffer(4),
      iconMime: "image/png",
    };

    expect(bgp.categoryImageOf(category)).toBe("blob:categoria");
    expect(bgp.categoryImageOf(category)).toBe("blob:categoria");
    expect(create).toHaveBeenCalledTimes(1);

    bgp.disposeThumbs();
    expect(revoke).toHaveBeenCalledWith("blob:categoria");

    create.mockRestore();
    revoke.mockRestore();
  });

  it("aceita ícone de imagem em data URL e ignora nome de ícone comum", () => {
    const bgp = useBackgroundProjectionLibrary();
    expect(
      bgp.categoryImageOf({
        id: "c10",
        name: "Data",
        iconType: "image",
        icon: "data:image/png;base64,AA==",
      })
    ).toBe("data:image/png;base64,AA==");
    expect(
      bgp.categoryImageOf({ id: "c11", name: "Ícone", iconType: "icon", icon: "leaf" })
    ).toBe("");
  });
});

describe("nome exibido da projeção", () => {
  it("prefere o nome próprio e cai no id quando vazio", () => {
    expect(backgroundProjectionName({ id: "x", name: "Fundo", path: "", type: "image" })).toBe(
      "Fundo"
    );
    expect(backgroundProjectionName({ id: "x", name: " ", path: "", type: "image" })).toBe("x");
  });
});
