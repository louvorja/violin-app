import { describe, expect, it } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { newItem } from "@/modules/liturgy/item";
import type { ProgramItem } from "@/types/Presentation";
import { programView } from "../previewView";

function onlineVideo(url: string): ProgramItem {
  return {
    id: "item-1",
    kind: "online_video",
    title: "Vídeo do culto",
    plannedMinutes: 5,
    source: newItem(LiturgyItemTypeEnum.VIDEO_ONLINE, {
      url,
      item: "Vídeo do culto",
    }),
  };
}

describe("prévia do item do programa", () => {
  it("leva o vídeo on-line para a prévia tocar, não só a miniatura", () => {
    expect(
      programView(onlineVideo("https://www.youtube.com/watch?v=abc12345678"))
    ).toEqual({
      kind: "online",
      title: "Vídeo do culto",
      icon: expect.any(String),
      playable: true,
      videoId: "abc12345678",
    });
  });

  it("aceita o link curto do YouTube", () => {
    expect(programView(onlineVideo("https://youtu.be/xyz78901234")).videoId).toBe(
      "xyz78901234"
    );
  });

  it("mantém o fallback quando o link não tem um vídeo do YouTube", () => {
    expect(programView(onlineVideo("https://example.com/video.mp4")).kind).toBe("other");
  });
});
