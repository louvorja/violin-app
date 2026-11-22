import { describe, expect, it } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { backgroundSoundItem } from "../items";

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
