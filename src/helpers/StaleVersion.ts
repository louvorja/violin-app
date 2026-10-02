/**
 * Depois de uma publicação, os arquivos da versão anterior somem: a aba que já
 * estava aberta não consegue mais baixar módulo, tela do menu, CSS nem tradução.
 * Recarregar sozinho derrubaria o que estiver tocando, então a decisão fica com
 * o operador — mas ele precisa ser avisado, onde quer que a falha aconteça.
 *
 * @category deve-virar-composable
 */
import Platform from "@/helpers/Platform";
import $snackbar from "@/helpers/Snackbar";
import { i18nAtual } from "@/i18n";

export function isStaleChunkError(err: unknown): boolean {
  return /dynamically imported module|preload CSS|module script failed/i.test(String(err));
}

/** Vale também offline: o service worker já guardou a versão nova. */
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
