import { describe, it, expect } from "vitest";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { _handleLiveMessage, useLiveContent } from "../useLiveContent";

/**
 * O espelho mostra o que está por cima no telão: o último conteúdo que entrou
 * no ar. Sair do ar devolve a vez ao que estava antes.
 */
describe("useLiveContent", () => {
  const { current, bible, file } = useLiveContent();

  it("o último conteúdo a entrar no ar é o que aparece", () => {
    _handleLiveMessage(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, { snapshot: { active: true } });
    expect(current.value).toBe("music");

    _handleLiveMessage(BROADCAST_TYPE.BIBLE_VERSE, { active: true, text: "Porque Deus amou…", reference: "João 3:16" });
    expect(current.value).toBe("bible");
    expect(bible.value?.reference).toBe("João 3:16");

    _handleLiveMessage(BROADCAST_TYPE.FILE_PROJECTION, { type: "image", url: "x.png", title: "Aviso" });
    expect(current.value).toBe("file");
    expect(file.value?.title).toBe("Aviso");
  });

  it("limpar o arquivo devolve a vez ao versículo; MEDIA_CLOSE não apaga a Bíblia", () => {
    _handleLiveMessage(BROADCAST_TYPE.FILE_PROJECTION, { action: "clear" });
    expect(current.value).toBe("bible");

    _handleLiveMessage(BROADCAST_TYPE.MEDIA_CLOSE, {});
    expect(current.value).toBe("bible");

    _handleLiveMessage(BROADCAST_TYPE.BIBLE_VERSE, { active: false, text: "" });
    expect(current.value).toBeNull();
  });

  it("um novo quadro da mesma música não a traz para cima de novo", () => {
    _handleLiveMessage(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, { snapshot: { active: true } });
    _handleLiveMessage(BROADCAST_TYPE.BIBLE_VERSE, { active: true, text: "Salmo 23", reference: "Sl 23:1" });
    _handleLiveMessage(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, { snapshot: { active: true } });
    expect(current.value).toBe("bible");
  });
});
