import { describe, expect, it } from "vitest";
import { resolveMediaReference } from "@/helpers/MediaUrl";

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

  it("rejeita protocolos e traversal", () => {
    expect(resolveMediaReference("ftp://cdn.louvorja.com/file.mp3")).toBeNull();
    expect(resolveMediaReference("/musics/../secret.mp3")).toBeNull();
  });
});
