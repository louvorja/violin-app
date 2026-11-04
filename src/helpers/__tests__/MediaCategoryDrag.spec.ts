import { describe, expect, it } from "vitest";
import {
  MEDIA_CATEGORY_DRAG_MIME,
  hasMediaCategoryDrag,
  readMediaCategoryDrag,
  writeMediaCategoryDrag,
} from "@/helpers/MediaCategoryDrag";

function fakeDataTransfer(initial: Record<string, string> = {}): DataTransfer {
  const data = new Map(Object.entries(initial));
  return {
    get types() {
      return Array.from(data.keys());
    },
    effectAllowed: "none",
    dropEffect: "none",
    setData(type: string, value: string) {
      data.set(type, value);
    },
    getData(type: string) {
      return data.get(type) || "";
    },
  } as unknown as DataTransfer;
}

describe("MediaCategoryDrag", () => {
  it("grava o payload no MIME próprio e marca a operação como move", () => {
    const dataTransfer = fakeDataTransfer();

    writeMediaCategoryDrag(dataTransfer, { source: "media_library", id: "arquivo-1" });

    expect(dataTransfer.effectAllowed).toBe("move");
    expect(dataTransfer.getData(MEDIA_CATEGORY_DRAG_MIME)).toBe(
      JSON.stringify({ source: "media_library", id: "arquivo-1" })
    );
    expect(hasMediaCategoryDrag(dataTransfer)).toBe(true);
  });

  it("lê payload válido da origem correta", () => {
    const dataTransfer = fakeDataTransfer({
      [MEDIA_CATEGORY_DRAG_MIME]: JSON.stringify({
        source: "background_projection",
        id: "fundo-1",
      }),
    });

    expect(readMediaCategoryDrag(dataTransfer)).toEqual({
      source: "background_projection",
      id: "fundo-1",
    });
  });

  it("aceita as origens dos módulos de som e vídeos personalizados", () => {
    for (const source of ["background_sound", "custom_online_videos"] as const) {
      expect(
        readMediaCategoryDrag(
          fakeDataTransfer({ [MEDIA_CATEGORY_DRAG_MIME]: JSON.stringify({ source, id: "1" }) })
        )
      ).toEqual({ source, id: "1" });
    }
  });

  it("recusa origem desconhecida, id vazio e JSON inválido", () => {
    expect(
      readMediaCategoryDrag(
        fakeDataTransfer({
          [MEDIA_CATEGORY_DRAG_MIME]: JSON.stringify({ source: "outra", id: "1" }),
        })
      )
    ).toBeNull();
    expect(
      readMediaCategoryDrag(
        fakeDataTransfer({
          [MEDIA_CATEGORY_DRAG_MIME]: JSON.stringify({ source: "media_library", id: "" }),
        })
      )
    ).toBeNull();
    expect(
      readMediaCategoryDrag(fakeDataTransfer({ [MEDIA_CATEGORY_DRAG_MIME]: "não é json" }))
    ).toBeNull();
  });

  it("trata dataTransfer ausente como ausência de arrasto interno", () => {
    expect(hasMediaCategoryDrag(null)).toBe(false);
    expect(readMediaCategoryDrag(null)).toBeNull();
    expect(() => writeMediaCategoryDrag(null, { source: "media_library", id: "1" })).not.toThrow();
  });
});
