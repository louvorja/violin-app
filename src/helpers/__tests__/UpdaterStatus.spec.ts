/**
 * Texto do status de atualização: a categoria decide, o texto cru nunca aparece.
 *
 * Este é o defeito reportado — com a API fora, Opções → Procurar atualizações
 * mostrava `getaddrinfo ENOTFOUND api.github.com`, porque o `Error` do Node
 * entrava direto no estado e a tela exibia. O main passou a devolver
 * `errorKind`, e o texto vem do i18n.
 */
import { describe, expect, it } from "vitest";
import { textoDoStatusDeAtualizacao } from "@/helpers/UpdaterStatus";

/** `t` que devolve a própria chave: o teste é sobre a ESCOLHA da chave. */
const t = (key: string) => key;

describe("status da atualização do app", () => {
  it("cada status tem a sua chave", () => {
    expect(textoDoStatusDeAtualizacao({ status: "idle" }, t)).toBe("options.updates.app_idle");
    expect(textoDoStatusDeAtualizacao({ status: "checking" }, t)).toBe(
      "options.updates.app_checking"
    );
    expect(textoDoStatusDeAtualizacao({ status: "downloading" }, t)).toBe(
      "options.updates.app_downloading"
    );
    expect(textoDoStatusDeAtualizacao({ status: "downloaded" }, t)).toBe(
      "options.updates.app_downloaded"
    );
    expect(textoDoStatusDeAtualizacao({ status: "not-available" }, t)).toBe(
      "options.updates.app_up_to_date"
    );
  });

  it("update disponível mostra a versão", () => {
    const tComNome = (key: string, named?: Record<string, unknown>) =>
      named?.version ? `${key}:${named.version}` : key;

    expect(textoDoStatusDeAtualizacao({ status: "available", newVersion: "2.1.0" }, tComNome)).toBe(
      "options.updates.app_available:2.1.0"
    );
  });
});

describe("falha na verificação", () => {
  it("sem rede tem texto próprio, de internet", () => {
    expect(textoDoStatusDeAtualizacao({ status: "error", errorKind: "network" }, t)).toBe(
      "options.updates.app_offline"
    );
  });

  it("erro do serviço (HTTP) cai na mensagem genérica", () => {
    /* O servidor respondeu: a internet funciona, quem não atendeu foi o GitHub. */
    expect(textoDoStatusDeAtualizacao({ status: "error", errorKind: "http" }, t)).toBe(
      "options.updates.app_error"
    );
  });

  it("erro desconhecido cai na mensagem genérica", () => {
    expect(textoDoStatusDeAtualizacao({ status: "error", errorKind: "unknown" }, t)).toBe(
      "options.updates.app_error"
    );
    expect(textoDoStatusDeAtualizacao({ status: "error" }, t)).toBe("options.updates.app_error");
  });

  it("NENHUM caminho devolve o texto cru nem o detalhe técnico", () => {
    /* A regressão que o operador viu: o `error`/`errorDetail` entravam no texto. */
    const estados = [
      { status: "error", errorKind: "network", error: "getaddrinfo ENOTFOUND api.github.com" },
      { status: "error", errorKind: "http", error: "HTTP 503 ao acessar …" },
      { status: "error", errorDetail: "socket hang up" },
      { status: "checking", errorDetail: "getaddrinfo ENOTFOUND api.github.com" },
      { status: "idle", errorDetail: "getaddrinfo ENOTFOUND api.github.com" },
    ];
    for (const estado of estados) {
      const texto = textoDoStatusDeAtualizacao(estado, t);
      expect(texto).not.toContain("getaddrinfo");
      expect(texto).not.toContain("ENOTFOUND");
      expect(texto).not.toContain("socket");
      expect(texto).not.toContain("HTTP 5");
      expect(texto.startsWith("options.updates.")).toBe(true);
    }
  });
});
