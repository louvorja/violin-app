import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";

const { getAll } = vi.hoisted(() => ({ getAll: vi.fn() }));

vi.mock("@/helpers/IndexedDB", () => ({ default: { getAll } }));

import {
  BACKGROUND_SOUND_ALL,
  BACKGROUND_SOUND_UNCATEGORIZED,
  backgroundSoundName,
  useBackgroundSoundLibrary,
} from "../useBackgroundSoundLibrary";

const records = [
  { id: "s2", name: "Chuva", fileName: "chuva.mp3", categoryId: "c1", order: 2 },
  { id: "s1", name: "", fileName: "Piano suave.mp3", categoryId: "", order: 1 },
  { id: "s3", name: "Órgão", fileName: "orgao.mp3", categoryId: "apagada", order: 3 },
];

const categories = [
  { id: "c1", name: "Natureza", color: "#3a7" },
  { id: "c2", name: "Instrumental" },
];

describe("biblioteca de som de fundo", () => {
  beforeEach(() => {
    getAll.mockReset();
    getAll.mockImplementation(async (table: string) => {
      if (table === DB_TABLE.BACKGROUND_SOUND_LIBRARY) return records;
      if (table === DB_TABLE.BACKGROUND_SOUND_CATEGORY) return categories;
      return [];
    });
  });

  it("carrega, ordena e trata categoria removida como sem categoria", async () => {
    const bgs = useBackgroundSoundLibrary();
    bgs.filter.value = BACKGROUND_SOUND_ALL;
    await bgs.load();

    expect(bgs.records.value.map((r) => r.id)).toEqual(["s1", "s2", "s3"]);
    expect(bgs.filtered.value).toHaveLength(3);
    expect(bgs.hasUncategorized.value).toBe(true);
    expect(bgs.countOf(BACKGROUND_SOUND_UNCATEGORIZED)).toBe(2);
    expect(bgs.displayName(records[1])).toBe("Piano suave");
  });

  it("filtra por categoria e mantém o filtro válido", async () => {
    const bgs = useBackgroundSoundLibrary();
    await bgs.load();
    bgs.filter.value = "c1";
    expect(bgs.filtered.value.map((r) => r.id)).toEqual(["s2"]);

    bgs.filter.value = "categoria-que-sumiu";
    await bgs.load();
    expect(bgs.filter.value).toBe(BACKGROUND_SOUND_ALL);
  });

  it("recria o ícone da categoria a partir dos bytes e revoga no descarte", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:categoria");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const bgs = useBackgroundSoundLibrary();
    await bgs.load();

    const category = {
      id: "c9",
      name: "Com imagem",
      iconType: "image" as const,
      icon: "blob:antigo",
      iconData: new ArrayBuffer(4),
      iconMime: "image/png",
    };

    expect(bgs.categoryImageOf(category)).toBe("blob:categoria");
    expect(bgs.categoryImageOf(category)).toBe("blob:categoria");
    expect(create).toHaveBeenCalledTimes(1);

    bgs.disposeCategoryIcons();
    expect(revoke).toHaveBeenCalledWith("blob:categoria");

    create.mockRestore();
    revoke.mockRestore();
  });

  it("aceita ícone de imagem em data URL e ignora nome de ícone comum", () => {
    const bgs = useBackgroundSoundLibrary();
    expect(
      bgs.categoryImageOf({
        id: "c10",
        name: "Data",
        iconType: "image",
        icon: "data:image/png;base64,AA==",
      })
    ).toBe("data:image/png;base64,AA==");
    expect(bgs.categoryImageOf({ id: "c11", name: "Ícone", icon: "leaf" })).toBe("");
  });
});

describe("nome exibido do som", () => {
  it("prefere o nome próprio e cai no arquivo sem extensão", () => {
    expect(backgroundSoundName({ id: "x", name: "Nome", fileName: "arq.mp3" })).toBe("Nome");
    expect(backgroundSoundName({ id: "x", name: "", fileName: "arq.mp3" })).toBe("arq");
  });
});
