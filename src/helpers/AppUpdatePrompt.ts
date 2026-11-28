/**
 * Aviso de atualização do app: o padrão do download automático e a medição
 * do caminho que a atualização faz desde a abertura.
 *
 * Por que existe: até aqui só a tela Opções → Atualizações mandava eventos de
 * atualização. A verificação da abertura, o aviso ("Atualizar agora", "Depois",
 * "Não mostrar novamente") e o download disparado por ele não mandavam nada —
 * justamente o caminho por onde quase toda atualização passa. Em 28/11/2026,
 * cerca de 30% das instalações em beta seguiam presas na versão antiga, e não
 * havia como saber se o aviso aparecia, se era recusado ou se a instalação
 * falhava.
 *
 * Eventos (todos leves, sem texto cru de erro):
 * - `app_update_check_started|completed|failed` ganham `trigger`
 *   ("startup" | "manual"); `app_update_check_timeout` e
 *   `app_update_check_skipped` (preferência desligada) só existem na abertura.
 * - `app_update_prompt_shown`, `app_update_prompt_suppressed` (versão
 *   dispensada antes) e `app_update_prompt_answered` (`action`: "update" |
 *   "later", com `dont_show_again`).
 * - `app_update_ready_to_install` e `app_update_download_errored`, pelo estado
 *   do atualizador — valem para o download automático, o do aviso e o das
 *   Opções. `ready_to_install` repetido em aberturas seguidas, sem mudar a
 *   versão do app, é instalação que não acontece.
 *
 * @category helper-puro — sem APIs Vue; leitura e envio chegam por parâmetro.
 */

/**
 * "Baixar atualizações automaticamente" vem ligado.
 *
 * Com o download manual, a atualização dependia de alguém aceitar o aviso da
 * abertura. Baixada em segundo plano, ela se instala ao fechar o app.
 */
export const AUTO_DOWNLOAD_UPDATES_DEFAULT = true;

/**
 * Valor efetivo da opção: só um "não" salvo desliga.
 *
 * Quem nunca mexeu na opção não tem nada salvo e fica com o padrão. Mesma regra
 * de `resolveAutoDownload` (electron/main/updateChannel.js), que o main usa ao
 * iniciar o atualizador — os dois lados precisam concordar.
 */
export function autoDownloadUpdatesEnabled(saved: unknown): boolean {
  return typeof saved === "boolean" ? saved : AUTO_DOWNLOAD_UPDATES_DEFAULT;
}

/**
 * O que a abertura faz quando a verificação encontra versão nova.
 *
 * - `prompt`: mostra o aviso (download manual, versão não dispensada).
 * - `suppressed`: a versão foi dispensada em "Não mostrar novamente"; segue a abertura.
 * - `continue`: download automático — o main já baixa em segundo plano e
 *   instala ao fechar, então a abertura segue sem esperar o download.
 * - `ignore`: o estado não veio da verificação da abertura (botão das Opções,
 *   replay), e a abertura não muda.
 */
export type StartupUpdateAction = "prompt" | "suppressed" | "continue" | "ignore";

export function startupActionForAvailableUpdate(input: {
  startupCheckPending: boolean;
  autoDownload: boolean;
  newVersion: string | null | undefined;
  skippedVersion: string | null | undefined;
}): StartupUpdateAction {
  if (!input.startupCheckPending) return "ignore";
  if (input.autoDownload) return "continue";
  if (input.skippedVersion && input.skippedVersion === input.newVersion) return "suppressed";
  return "prompt";
}

export type UpdateCheckTrigger = "startup" | "manual";

export type UpdateTrack = (event: string, properties?: Record<string, unknown>) => void;

export interface UpdaterStateForTelemetry {
  status: string;
  newVersion?: string | null;
  errorKind?: string | null;
  installRequiresElevation?: boolean;
}

const ERROR_KINDS = new Set(["network", "http", "unknown"]);

/**
 * Acompanha os estados do atualizador e registra o desfecho de cada download.
 *
 * - `downloaded` → `app_update_ready_to_install`, uma vez por versão nesta
 *   execução (o mesmo estado chega de novo pelo replay do `status()` e pelo
 *   diálogo).
 * - `error` logo depois de `downloading` → `app_update_download_errored`.
 *   Um erro da verificação (sem download em curso) não conta aqui: ele já sai
 *   em `app_update_check_failed`.
 */
export function createUpdateOutcomeTracker(
  track: UpdateTrack
): (state: UpdaterStateForTelemetry | null | undefined) => void {
  let downloadingVersion: string | null = null;
  const readyVersions = new Set<string>();

  return (state) => {
    if (!state) return;
    const version = state.newVersion || null;

    if (state.status === "downloading") {
      downloadingVersion = version ?? downloadingVersion ?? "";
      return;
    }

    if (state.status === "downloaded") {
      downloadingVersion = null;
      if (!version || readyVersions.has(version)) return;
      readyVersions.add(version);
      track("app_update_ready_to_install", {
        version,
        install_requires_elevation: state.installRequiresElevation === true,
      });
      return;
    }

    if (state.status === "error" && downloadingVersion !== null) {
      const errorKind = ERROR_KINDS.has(String(state.errorKind)) ? state.errorKind : "unknown";
      track("app_update_download_errored", {
        version: downloadingVersion || version,
        error_kind: errorKind,
      });
      downloadingVersion = null;
      return;
    }

    // Cancelado (volta a "available") ou nova verificação: nenhum download em curso.
    if (state.status !== "error") downloadingVersion = null;
  };
}
