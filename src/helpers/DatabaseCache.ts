/**
 * Limpar o cache do banco — a mesma operação no ⇧⌘F2 / Ctrl+Shift+F2, no menu
 * Dev, em Atualizações e em Armazenamento. O catálogo volta da rede quando for
 * pedido de novo.
 *
 * @category deve-virar-composable — Lê o estado de conexão pelo AppData.
 */
import $database from "@/helpers/Database";
import $appdata from "@/helpers/AppData";
import $snackbar from "@/helpers/Snackbar";
import Platform from "@/helpers/Platform";
import { KEYS } from "@/constants/UserDataKeys";
import { i18nAtual } from "@/i18n";

function t(key: string, fallback: string): string {
  const translate = i18nAtual()?.global?.t;
  return translate ? translate(key) : fallback;
}

/** Devolve `false` quando recusou a limpeza. */
export async function clearDatabaseCache({ notify = true } = {}): Promise<boolean> {
  // Na web o IndexedDB e o service worker são a única cópia: sem internet o
  // catálogo sumiria até a conexão voltar. No desktop o main guarda os JSONs
  // expirados como reserva, então limpar sem internet não perde nada.
  if (!Platform.isDesktop && $appdata.get<boolean>(KEYS.SHELL.IS_ONLINE, true) === false) {
    $snackbar.warning(
      t(
        "options.storage.clear_cache_offline",
        "Sem internet, o cache do banco não foi limpo: o catálogo ficaria indisponível."
      ),
      { key: "clear-db-cache" }
    );
    return false;
  }
  await $database.invalidateAll();
  if (notify) {
    $snackbar.success(t("options.updates.cache_cleared", "Cache limpo."), {
      key: "clear-db-cache",
    });
  }
  return true;
}
