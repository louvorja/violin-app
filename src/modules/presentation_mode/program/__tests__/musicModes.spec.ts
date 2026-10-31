import { describe, expect, it } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { ProgramItem } from "@/types/Presentation";
import { liturgyItem } from "../liturgy";
import { applyOverride, needsModeChoice } from "../musicModes";

const item = (fields: Partial<Parameters<typeof liturgyItem>[0]>): ProgramItem => ({
  id: "i",
  kind: "music",
  title: "Hino",
  plannedMinutes: 3,
  source: liturgyItem({ id: "s", tipo: LiturgyItemTypeEnum.MUSICA, id_music: 211, musica: 211, ...fields }),
});

describe("needsModeChoice", () => {
  it("música sem versão definida pede a escolha; com versão, abre direto", () => {
    expect(needsModeChoice(item({ subtipo: "" }))).toBe(true);
    expect(needsModeChoice(item({ subtipo: "sung" }))).toBe(false);
    expect(needsModeChoice(item({ subtipo: "pb" }))).toBe(false);
  });

  it("música a escolher (qual música) e itens que não são música não entram", () => {
    expect(needsModeChoice(item({ subtipo: "", escolha: true }))).toBe(false);
    expect(needsModeChoice({ source: liturgyItem({ id: "a", tipo: LiturgyItemTypeEnum.ARQUIVO, dir: "/x.mp4" }) })).toBe(false);
    expect(needsModeChoice({})).toBe(false);
  });
});

describe("applyOverride", () => {
  it("sem versão no topo, cada música fica com a sua", () => {
    expect(applyOverride("pb", "")).toBe("pb");
    expect(applyOverride("lyric", "")).toBe("lyric");
  });

  it("a versão do topo vence a do item", () => {
    expect(applyOverride("pb", "lyric")).toBe("lyric");
    expect(applyOverride("sung", "pb")).toBe("pb");
    expect(applyOverride("lyric", "sung")).toBe("sung");
  });

  it("só áudio (música ambiente) não muda", () => {
    expect(applyOverride("audio", "lyric")).toBe("audio");
    expect(applyOverride("audio_pb", "sung")).toBe("audio_pb");
  });
});
