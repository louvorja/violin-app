/**
 * Texto do status de atualização do app, por categoria.
 *
 * Existe como função pura por um motivo concreto: a tabela mora num componente
 * de ~900 linhas que só pode ser montado com `isDesktop: true`, e o spec da
 * tela monta com `isDesktop: false` — ou seja, este caminho nunca foi testado.
 *
 * O ponto de fundo: **erro cru não vira texto de tela**. O main devolve uma
 * categoria (`network` | `http` | `unknown`) e o texto vem do i18n. Sem isso o
 * operador lia `getaddrinfo ENOTFOUND api.github.com` em Opções → Procurar
 * atualizações, porque o `Error` do Node entrava direto no estado.
 *
 * @category helper-puro — sem APIs Vue; o `t` chega por parâmetro.
 */

export type AppUpdateStatusText =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface AppUpdateStateForText {
  status: string;
  version?: string | null;
  progress?: number;
  newVersion?: string | null;
  /**
   * Categoria da falha: "network" | "http" | "unknown".
   *
   * `string` de propósito — é o que chega do IPC, sem tipo do outro lado. O
   * texto cru NÃO entra aqui; só a categoria, que o main valida antes de enviar.
   */
  errorKind?: string | null;
  /** Detalhe técnico, só para diagnóstico — nunca exibido. */
  errorDetail?: string | null;
}

/** `t` do vue-i18n, na forma que este helper precisa. */
type Translate = (key: string, named?: Record<string, unknown>) => string;

/**
 * Falha de rede tem texto próprio; o resto (HTTP 500, resposta inesperada) cai
 * na mensagem genérica de "erro ao verificar".
 *
 * `error` é deliberadamente ignorado: é o campo que carregava o texto cru.
 */
function _textoDeErro(errorKind: AppUpdateStateForText["errorKind"], t: Translate): string {
  if (errorKind === "network") return t("options.updates.app_offline");
  return t("options.updates.app_error");
}

export function textoDoStatusDeAtualizacao(state: AppUpdateStateForText, t: Translate): string {
  switch (state.status) {
    case "checking":
      return t("options.updates.app_checking");
    case "available":
      return t("options.updates.app_available", { version: state.newVersion });
    case "not-available":
      return t("options.updates.app_up_to_date");
    case "downloading":
      return t("options.updates.app_downloading");
    case "downloaded":
      return t("options.updates.app_downloaded");
    case "error":
      return _textoDeErro(state.errorKind, t);
    default:
      return t("options.updates.app_idle");
  }
}
