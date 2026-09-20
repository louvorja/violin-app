import { describe, expect, it } from "vitest";
import { normalizeYouTubeError } from "@/helpers/YouTubeError";

describe("normalizeYouTubeError", () => {
  it.each([
    [2, "invalid_parameter"],
    [5, "html5_error"],
    [100, "video_not_found"],
    [101, "embed_not_allowed"],
    [150, "embed_not_allowed"],
  ] as const)("normaliza o código %s", (code, kind) => {
    const result = normalizeYouTubeError({ data: code });

    expect(result.code).toBe(code);
    expect(result.kind).toBe(kind);
    expect(result.properties).toMatchObject({
      youtube_error_code: code,
      youtube_error_kind: kind,
    });
    expect(result.message).not.toContain("[object Object]");
  });

  it("extrai mensagem estruturada sem serializar o objeto como texto", () => {
    const result = normalizeYouTubeError({
      data: { code: 999, message: "falha do provedor", name: "ProviderError" },
    });

    expect(result).toMatchObject({
      code: 999,
      message: "falha do provedor",
      name: "ProviderError",
      kind: "unknown",
    });
  });

  it("aceita Error e valores desconhecidos com fallback seguro", () => {
    expect(normalizeYouTubeError(new Error("erro de rede")).message).toBe("erro de rede");
    expect(normalizeYouTubeError({ data: { unexpected: true } }).message).toBe(
      "Erro desconhecido do YouTube",
    );
  });
});
