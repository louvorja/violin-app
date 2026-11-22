import { describe, expect, it } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { backgroundProjectionItem, backgroundSoundItem } from "../items";

describe("item de som de fundo", () => {
  it("aponta para a biblioteca e executa pelo motor da liturgia", () => {
    const item = backgroundSoundItem(
      { id: "som-1", name: "Instrumental suave", fileName: "suave.mp3" },
      "Adoração"
    );

    expect(item).toMatchObject({
      kind: "audio",
      title: "Instrumental suave",
      subtitle: "Adoração",
      plannedMinutes: 5,
    });
    expect(item.source).toMatchObject({
      tipo: LiturgyItemTypeEnum.BG_SOUND,
      ref_id: "som-1",
      item: "Instrumental suave",
      subitem: "Instrumental suave",
      subtipo: "audio",
    });
  });

  it("usa o nome do arquivo sem extensão quando não há nome próprio", () => {
    const item = backgroundSoundItem({ id: "som-2", name: "", fileName: "piano.mp3" });
    expect(item.title).toBe("piano");
    expect(item.subtitle).toBeUndefined();
  });
});

describe("item de projeção de fundo", () => {
  it("aponta para a biblioteca e assume imagem ou vídeo", () => {
    const image = backgroundProjectionItem(
      { id: "bg-1", name: "Fundo do culto", type: "image" },
      "Culto"
    );
    expect(image).toMatchObject({
      kind: "image",
      title: "Fundo do culto",
      subtitle: "Culto",
      plannedMinutes: 1,
    });
    expect(image.source).toMatchObject({
      tipo: LiturgyItemTypeEnum.BG_PROJECTION,
      ref_id: "bg-1",
      item: "Fundo do culto",
      subitem: "Fundo do culto",
      subtipo: "image",
    });

    const video = backgroundProjectionItem({ id: "bg-2", name: "Mar", type: "video" });
    expect(video.kind).toBe("video");
    expect(video.plannedMinutes).toBe(5);
    expect(video.subtitle).toBeUndefined();
  });

  it("usa o id como título quando o registro não tem nome", () => {
    const item = backgroundProjectionItem({ id: "bg-3", name: "  ", type: "image" });
    expect(item.title).toBe("bg-3");
  });
});
