import { describe, expect, it } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";
import { canLinkOverlay } from "./overlayLink";

function item(tipo: LiturgyItemTypeEnum, fields: Partial<LiturgyItem> = {}): LiturgyItem {
  return { id: "item-1", tipo, ...fields } as LiturgyItem;
}

describe("vínculo de sobreposição — disponibilidade no formulário", () => {
  it("oferece o vínculo para projeções de arquivo, mas não para áudio ou vídeo externo", () => {
    expect(canLinkOverlay(item(LiturgyItemTypeEnum.ARQUIVO, { dir: "/culto/aviso.png" }))).toBe(true);
    expect(canLinkOverlay(item(LiturgyItemTypeEnum.ARQUIVO, { dir: "/culto/slides.slja" }))).toBe(true);
    expect(canLinkOverlay(item(LiturgyItemTypeEnum.ARQUIVO, { dir: "/culto/audio.mp3" }))).toBe(false);
    expect(canLinkOverlay(item(LiturgyItemTypeEnum.ARQUIVO, { dir: "/culto/video.mp4" }), {
      systemMediaPlayer: true,
    })).toBe(false);
  });

  it("exige música escolhida em um modo que realmente mostra slides", () => {
    const selected = item(LiturgyItemTypeEnum.MUSICA, { id_music: 42, subtipo: "sung" });
    expect(canLinkOverlay(selected)).toBe(true);
    expect(canLinkOverlay({ ...selected, subtipo: "audio" })).toBe(false);
    expect(canLinkOverlay({ ...selected, id_music: undefined })).toBe(false);
    expect(canLinkOverlay({ ...selected, id_music: -1, ref_id: "custom-1" })).toBe(true);
  });

  it('oferece o vínculo para "escolher na hora" — a música só existe na execução', () => {
    /* O formulário ainda não conhece a música nem a versão; a execução decide
       se o hino escolhido projeta slides (modo áudio continua sem overlay). */
    expect(
      canLinkOverlay(item(LiturgyItemTypeEnum.MUSICA, { escolha: true, musica: -1 }))
    ).toBe(true);
    expect(canLinkOverlay({ ...item(LiturgyItemTypeEnum.MUSICA), escolha: true })).toBe(true);
  });

  it("exige slides de anúncio disponíveis e selecionados", () => {
    const announcements = item(LiturgyItemTypeEnum.ANUNCIOS, { anuncios_ids: ["slide-1"] });
    expect(canLinkOverlay(announcements, { availableAnnouncementIds: [] })).toBe(false);
    expect(canLinkOverlay(announcements, { availableAnnouncementIds: ["slide-2"] })).toBe(false);
    expect(canLinkOverlay(announcements, { availableAnnouncementIds: ["slide-1"] })).toBe(true);
    expect(canLinkOverlay({ ...announcements, anuncios_ids: [] }, {
      availableAnnouncementIds: ["slide-1"],
    })).toBe(false);
  });

  it("não oferece o vínculo para ações que não projetam", () => {
    expect(canLinkOverlay(item(LiturgyItemTypeEnum.ANOTACAO))).toBe(false);
    expect(canLinkOverlay(item(LiturgyItemTypeEnum.BG_SOUND))).toBe(false);
    expect(canLinkOverlay(item(LiturgyItemTypeEnum.SITE, {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }))).toBe(false);
  });
});
