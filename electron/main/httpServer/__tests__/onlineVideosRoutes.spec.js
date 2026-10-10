// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  extractYoutubeVideoId,
  hasOnlineVideosPermission,
  isOnlineVideoImageResponse,
  isOnlineVideosAlbumsResponse,
  isOnlineVideosVideosResponse,
} from "../routes.js";

describe("extractYoutubeVideoId — só o id sai da rota", () => {
  it("aceita um id cru de 11 caracteres", () => {
    expect(extractYoutubeVideoId("abcdefghijk")).toBe("abcdefghijk");
  });

  it.each([
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://m.youtube.com/watch?v=abcdefghijk&t=42",
    "https://youtu.be/abcdefghijk",
    "https://www.youtube.com/embed/abcdefghijk",
    "https://www.youtube.com/shorts/abcdefghijk",
    "https://www.youtube.com/live/abcdefghijk",
    "  https://youtu.be/abcdefghijk  ",
  ])("extrai o id de %s", (url) => {
    expect(extractYoutubeVideoId(url)).toBe("abcdefghijk");
  });

  it.each(["", "   ", "abcdefghij", "https://youtube.com/watch", "https://example.com/v=abcdefghijk", 42])(
    "recusa %s",
    (valor) => {
      expect(extractYoutubeVideoId(valor)).toBeNull();
    }
  );
});

describe("hasOnlineVideosPermission — permission online_videos", () => {
  const reqCom = (permissions) => ({ authInfo: { permissions } });

  it("libera root e online_videos", () => {
    expect(hasOnlineVideosPermission(reqCom(["root"]))).toBe(true);
    expect(hasOnlineVideosPermission(reqCom(["online_videos"]))).toBe(true);
    expect(hasOnlineVideosPermission(reqCom(["music", "online_videos"]))).toBe(true);
  });

  it("bloqueia device sem a permission, mesmo com as outras", () => {
    expect(hasOnlineVideosPermission(reqCom(["music"]))).toBe(false);
    expect(hasOnlineVideosPermission(reqCom(["chat", "bible"]))).toBe(false);
    expect(hasOnlineVideosPermission(reqCom([]))).toBe(false);
  });

  it("libera quando não há authInfo (token global/localhost)", () => {
    expect(hasOnlineVideosPermission({})).toBe(true);
    expect(hasOnlineVideosPermission({ authInfo: undefined })).toBe(true);
  });
});

describe("validação das respostas de vídeo do renderer", () => {
  const album = {
    id: "online:PL123",
    title: "Adoração",
    subtitle: "Canal LouvorJA",
    count: 12,
    source: "online",
  };
  const video = { id: "abcdefghijk", title: "Mensagem", url: "https://youtu.be/abcdefghijk", source: "custom" };

  it("aceita o envelope de álbuns", () => {
    expect(isOnlineVideosAlbumsResponse({ status: "ok", albums: [album] })).toBe(true);
    expect(
      isOnlineVideosAlbumsResponse({
        status: "ok",
        albums: [{ ...album, title: null, subtitle: null }],
      })
    ).toBe(true);
  });

  it("rejeita álbuns fora do contrato", () => {
    expect(isOnlineVideosAlbumsResponse({ status: "ok" })).toBe(false);
    expect(isOnlineVideosAlbumsResponse({ status: "ok", albums: [{ ...album, source: "outro" }] })).toBe(false);
    expect(
      isOnlineVideosAlbumsResponse({
        status: "ok",
        albums: [{ ...album, count: -1 }],
      })
    ).toBe(false);
    expect(isOnlineVideosAlbumsResponse(null)).toBe(false);
  });

  it("aceita channel nulo (Meus Vídeos), o nome do canal, e rejeita lixo", () => {
    expect(
      isOnlineVideosVideosResponse({ status: "ok", videos: [{ ...video, channel: "Canal LouvorJA" }] })
    ).toBe(true);
    expect(isOnlineVideosVideosResponse({ status: "ok", videos: [{ ...video, channel: null }] })).toBe(true);
    expect(
      isOnlineVideosVideosResponse({ status: "ok", videos: [{ ...video, channel: "x".repeat(1_001) }] })
    ).toBe(false);
    expect(isOnlineVideosVideosResponse({ status: "ok", videos: [{ ...video, channel: 42 }] })).toBe(false);
  });

  it("aceita o envelope de vídeos e rejeita o que estoura limite", () => {
    expect(isOnlineVideosVideosResponse({ status: "ok", videos: [video] })).toBe(true);
    expect(isOnlineVideosVideosResponse({ status: "ok", videos: [{ ...video, url: "x".repeat(2_049) }] })).toBe(
      false
    );
    expect(isOnlineVideosVideosResponse({ status: "erro", videos: [] })).toBe(false);
  });
});

describe("miniaturas — campo image nas listas e binário na rota", () => {
  const base = { id: "abcdefghijk", title: "Mensagem", url: "https://youtu.be/abcdefghijk", source: "custom" };
  const albumBase = {
    id: "custom:cat-1",
    title: "Natal",
    subtitle: null,
    count: 2,
    source: "custom",
  };

  it("aceita image nulo, caminho relativo ou URL http", () => {
    for (const image of [
      null,
      undefined,
      "/api/online-videos/image?kind=video&id=vid-1",
      "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    ]) {
      expect(isOnlineVideosVideosResponse({ status: "ok", videos: [{ ...base, image }] })).toBe(true);
      expect(isOnlineVideosAlbumsResponse({ status: "ok", albums: [{ ...albumBase, image }] })).toBe(true);
    }
  });

  it("rejeita image que não é string curta (caminho, não bytes)", () => {
    expect(
      isOnlineVideosVideosResponse({ status: "ok", videos: [{ ...base, image: "x".repeat(4_097) }] })
    ).toBe(false);
    expect(isOnlineVideosAlbumsResponse({ status: "ok", albums: [{ ...albumBase, image: 42 }] })).toBe(false);
  });

  it("valida o binário da miniatura (mime de imagem ou ausência)", () => {
    expect(isOnlineVideoImageResponse({ status: "ok", mime: "image/jpeg", data: new ArrayBuffer(4) })).toBe(
      true
    );
    expect(isOnlineVideoImageResponse({ status: "ok", mime: "", data: null })).toBe(true);
    expect(isOnlineVideoImageResponse({ status: "ok", mime: "text/plain", data: new ArrayBuffer(4) })).toBe(
      false
    );
    expect(isOnlineVideoImageResponse({ status: "ok", mime: "image/jpeg", data: "base64" })).toBe(false);
    expect(isOnlineVideoImageResponse({ status: "erro", mime: "image/jpeg", data: null })).toBe(false);
    expect(isOnlineVideoImageResponse(null)).toBe(false);
  });
});
