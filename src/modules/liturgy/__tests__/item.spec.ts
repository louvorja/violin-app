import { describe, expect, it } from "vitest";
import { LiturgyItemTypeEnum as T } from "@/enums/LiturgyItemTypeEnum";
import { isYoutube, kindOf, kindOfPath, newItem } from "../item";

describe("item da liturgia", () => {
  it("classifica arquivos pela extensão, sem diferenciar maiúsculas", () => {
    expect(kindOfPath("/a/b.jpeg")).toBe("image");
    expect(kindOfPath("C:\\Culto\\Testemunho.MP4")).toBe("video");
    expect(kindOfPath("sermao.PPTX")).toBe("presentation");
    expect(kindOfPath("hino.opus")).toBe("audio");
    expect(kindOfPath("https://x.com/foto.png?v=2")).toBe("image");
    expect(kindOfPath("leia-me")).toBe("file");
  });

  it("diz o que cada tipo projeta", () => {
    expect(kindOf(newItem(T.MUSICA))).toBe("music");
    expect(kindOf(newItem(T.ARQUIVO, { dir: "/fotos/culto.jpg" }))).toBe("image");
    expect(kindOf(newItem(T.SITE, { url: "https://youtu.be/abc" }))).toBe("online_video");
    expect(kindOf(newItem(T.SITE, { url: "https://www.canva.com/design/x" }))).toBe("site");
    expect(kindOf(newItem(T.VIDEO_ONLINE))).toBe("online_video");
    expect(kindOf(newItem(T.MEDIA_LIBRARY, { subtipo: "pdf" }))).toBe("presentation");
    expect(kindOf(newItem(T.BG_SOUND))).toBe("audio");
    expect(kindOf(newItem(T.ANUNCIOS))).toBe("announcements");
    expect(kindOf(newItem(T.OVERLAY))).toBe("overlay");
    expect(kindOf(newItem(T.ITENS_AGENDADOS))).toBe("scheduled");
  });

  it("o que não projeta nada é anotação", () => {
    expect(kindOf(newItem(T.ANOTACAO))).toBe("note");
    expect(kindOf(newItem(T.BLOCO))).toBe("note");
  });

  it("monta o item completo com os padrões do formato e um id novo", () => {
    const a = newItem(T.ARQUIVO, { dir: "/x.mp4", item: "Vídeo" });
    expect(a).toMatchObject({
      tipo: T.ARQUIVO,
      dir: "/x.mp4",
      item: "Vídeo",
      dir_info: "E",
      musica: -1,
    });
    expect(a.id).not.toBe("");
    expect(newItem(T.ARQUIVO).id).not.toBe(a.id);
    expect(newItem(T.MUSICA, { id: "m1" }).id).toBe("m1");
  });

  it("o tipo do argumento vence o que vier nos campos", () => {
    const base = newItem(T.ANOTACAO, { item: "Base" });
    expect(newItem(T.MUSICA, { ...base }).tipo).toBe(T.MUSICA);
  });

  it("reconhece links do YouTube", () => {
    expect(isYoutube("https://www.youtube.com/watch?v=x")).toBe(true);
    expect(isYoutube("https://youtu.be/x")).toBe(true);
    expect(isYoutube("https://vimeo.com/1")).toBe(false);
    expect(isYoutube(null)).toBe(false);
  });
});
