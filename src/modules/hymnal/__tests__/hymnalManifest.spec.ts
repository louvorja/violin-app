import { describe, expect, it } from "vitest";
import { ICONS } from "@/config/Icons";
import { MUSIC_EXECUTIONS } from "@/config/MusicAction";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { createHymnalManifest } from "../hymnalManifest";

// Botão da ribbon → modo que o HymnalBrowser executa para ele.
const RIBBON_ACTION: Record<string, MusicActionEnum> = {
  sing: MusicActionEnum.AUDIO,
  playback: MusicActionEnum.INSTRUMENTAL,
  no_audio: MusicActionEnum.NO_AUDIO,
  audio_play: MusicActionEnum.AUDIO_ONLY,
  audio_inst: MusicActionEnum.PLAYBACK_ONLY,
};

describe("ribbon do hinário", () => {
  const { contextualPages } = createHymnalManifest({
    id: ModuleEnum.HYMNAL,
    name: "Hinário Adventista",
    color: "#c0392b",
    icon: ICONS.MODULES.HYMNAL,
  });
  const buttons = contextualPages[0].groups.flatMap((group) => group.buttons ?? []);
  const icon = (id: string) => buttons.find((button) => button.id === id)?.icon;

  it("usa nos botões de execução os ícones da linha da música (#52)", () => {
    for (const [id, action] of Object.entries(RIBBON_ACTION)) {
      const row = MUSIC_EXECUTIONS.find((item) => item.action === action);
      expect(icon(id), id).toBe(row?.icon);
    }
  });

  it("e no botão Letra o mesmo ícone da linha", () => {
    expect(icon("lyric")).toBe(ICONS.MUSIC.LYRIC);
  });
});
