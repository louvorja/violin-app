/**
 * @category helper-puro — Falhas que nascem da máquina do usuário, não do código.
 *
 * Arquivo bloqueado/removido depois de escolhido, disco cheio, banco local do
 * navegador corrompido ou preso por antivírus/sincronizador: nada disso é
 * defeito do app e não deve virar issue de erro. A telemetria registra como
 * aviso e a interface explica o que o operador pode fazer.
 */

export type LocalEnvironmentErrorKind = "file_unreadable" | "storage_full" | "storage_unavailable";

function field(error: unknown, key: "name" | "message"): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function classifyLocalEnvironmentError(error: unknown): LocalEnvironmentErrorKind | null {
  const name = field(error, "name");
  const message = field(error, "message");

  if (name === "NotReadableError") return "file_unreadable";
  if (name === "QuotaExceededError") return "storage_full";
  if (name === "UnknownError" && /internal error|indexeddb/i.test(message)) {
    return "storage_unavailable";
  }
  if (name === "AbortError" && /transaction was aborted/i.test(message)) {
    return "storage_unavailable";
  }
  return null;
}

export function isLocalEnvironmentError(error: unknown): boolean {
  return classifyLocalEnvironmentError(error) !== null;
}
