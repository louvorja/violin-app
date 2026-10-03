import { describe, expect, it } from "vitest";
import { audioFailure } from "../AudioFailure";

const erro = (name: string) => Object.assign(new Error("x"), { name });

describe("aviso de falha de áudio", () => {
  it("streaming sem internet: o arquivo não está no aparelho, e não é culpa do formato", () => {
    expect(audioFailure(erro("NotSupportedError"), { streaming: true, online: false })).toEqual({
      text: "modules.media.alerts.offline_not_downloaded",
      retryable: true,
    });
  });

  it("streaming com internet: a fonte não carregou, e dá para tentar de novo", () => {
    expect(audioFailure(erro("NotSupportedError"), { streaming: true, online: true })).toEqual({
      text: "modules.media.alerts.not_loaded",
      retryable: true,
    });
  });

  it("arquivo já em memória que o navegador recusa: aí sim é o formato", () => {
    expect(audioFailure(erro("NotSupportedError"), { streaming: false, online: true })).toEqual({
      text: "modules.media.alerts.unsupported",
      retryable: false,
    });
  });

  it("os demais erros não dependem da fonte", () => {
    const fonte = { streaming: true, online: false };
    expect(audioFailure(erro("DecodeError"), fonte).text).toBe("modules.media.alerts.decode");
    expect(audioFailure(erro("NotAllowedError"), fonte)).toEqual({
      text: "modules.media.alerts.blocked",
      retryable: false,
    });
    expect(audioFailure("", fonte)).toEqual({
      text: "modules.media.alerts.not_loaded",
      retryable: true,
    });
  });
});
