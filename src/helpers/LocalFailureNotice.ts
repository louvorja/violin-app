/**
 * @category deve-virar-composable — Usa Alert (Pinia) e o i18n do renderer.
 *
 * Aviso ao operador para falhas que vêm da máquina dele (ver
 * LocalEnvironmentErrors): explica o que aconteceu e o que fazer, sem
 * parecer defeito do app. O texto vem de `alert.local_*` no i18n global.
 */
import Alert from "@/helpers/Alert";
import { i18nAtual } from "@/i18n";
import {
  classifyLocalEnvironmentError,
  type LocalEnvironmentErrorKind,
} from "@/helpers/LocalEnvironmentErrors";

const MESSAGE_KEY: Record<LocalEnvironmentErrorKind, string> = {
  file_unreadable: "alert.local_file_unreadable",
  storage_full: "alert.local_storage_full",
  storage_unavailable: "alert.local_storage_unavailable",
};

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

export function notifyLocalEnvironmentFailure(
  kind: LocalEnvironmentErrorKind,
  names: string[]
): void {
  const translate = i18nAtual()?.global?.t;
  const joined = escapeHtml(names.join(", "));
  const text = translate ? (translate(MESSAGE_KEY[kind], { names: joined }) as string) : joined;
  Alert.info({ text, translate: false });
}

/**
 * Se `error` é uma falha do ambiente, registra aviso, informa o operador e
 * devolve true. Caso contrário devolve false e o chamador decide.
 */
export function reportLocalFileFailure(error: unknown, names: string[]): boolean {
  const kind = classifyLocalEnvironmentError(error);
  if (!kind) return false;
  console.warn("[arquivo local] não foi possível processar:", names.join(", "), error);
  notifyLocalEnvironmentFailure(kind, names);
  return true;
}
