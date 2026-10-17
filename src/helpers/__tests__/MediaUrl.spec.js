import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/Api", () => ({
  API_URL_FILES: "https://api.test/file",
  MEDIA_URL: "https://media.test/",
  LEGACY_MEDIA_PREFIXES: ["https://api.test/file", "https://reserva.test/file"],
}));

import { currentUrlOfLegacyMedia, resolveMediaReference } from "@/helpers/MediaUrl";

describe("resolveMediaReference", () => {
  it("mantém URL completa e extrai o caminho local", () => {
    expect(resolveMediaReference("https://cdn.louvorja.com/musics/pt/hino.opus")).toEqual({
      url: "https://cdn.louvorja.com/musics/pt/hino.opus",
      relativePath: "/musics/pt/hino.opus",
    });
  });

  it("aceita o formato relativo antigo", () => {
    const result = resolveMediaReference("/images/capa.jpg");
    expect(result?.relativePath).toBe("/images/capa.jpg");
    expect(result?.url).toContain("/images/capa.jpg");
  });

  it("remove o prefixo /file de URLs antigas completas", () => {
    expect(
      resolveMediaReference("https://api.louvorja.com.br/file/covers/capa.bmp")?.relativePath
    ).toBe("/covers/capa.bmp");
  });

  it("não reescreve o endereço na leitura: o catálogo renovado já traz o certo", () => {
    expect(resolveMediaReference("https://api.test/file/musics/pt/hino.opus")?.url).toBe(
      "https://api.test/file/musics/pt/hino.opus"
    );
  });

  it("rejeita protocolos e traversal", () => {
    expect(resolveMediaReference("ftp://cdn.louvorja.com/file.mp3")).toBeNull();
    expect(resolveMediaReference("/musics/../secret.mp3")).toBeNull();
  });
});

describe("currentUrlOfLegacyMedia", () => {
  it.each([
    ["https://api.test/file/musics/pt/A/x.opus", "https://media.test/musics/pt/A/x.opus"],
    ["https://reserva.test/file/covers/1.jpg?v=2", "https://media.test/covers/1.jpg?v=2"],
  ])("troca o prefixo configurado da API pelo da mídia: %s", (legacy, expected) => {
    expect(currentUrlOfLegacyMedia(legacy)).toBe(expected);
  });

  it.each([
    "https://media.test/musics/pt/A/x.opus",
    "https://api.test/params",
    "https://outro.test/file/musics/x.opus",
    "/musics/pt/A/x.opus",
  ])("devolve null para o que não é do /file configurado: %s", (url) => {
    expect(currentUrlOfLegacyMedia(url)).toBeNull();
  });
});
