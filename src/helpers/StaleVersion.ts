/**
 * A importação sob demanda pode falhar por rede, resposta inválida ou porque
 * a aba ainda pede arquivos de uma versão anterior. A mensagem do navegador
 * não distingue essas causas. Recarregar sozinho derrubaria o que estiver
 * tocando, então a decisão fica com o operador.
 *
 * @category deve-virar-composable
 */
import Platform from "@/helpers/Platform";
import $snackbar from "@/helpers/Snackbar";
import { i18nAtual } from "@/i18n";

export function isStaleChunkError(err: unknown): boolean {
  return /dynamically imported module|preload CSS|module script failed/i.test(String(err));
}

/** A falha não comprova que existe uma versão nova ou que ela já foi guardada offline. */
export function notifyStaleVersion(): void {
  if (Platform.isDesktop) return;
  $snackbar.show({
    text: i18nAtual()?.global.t("shell.stale_version") ?? "",
    color: "warning",
    timeout: 15000,
    key: "stale_version",
    action: () => window.location.reload(),
  });
}

/** O Vite avisa por este evento toda importação sob demanda que falha. */
export function watchStaleVersion(): void {
  if (Platform.isDesktop || typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (isStaleChunkError((event as Event & { payload?: unknown }).payload)) notifyStaleVersion();
  });
}
