/**
 * Nome de arquivo aceito em Windows, macOS e Linux, sem perder acentos.
 *
 * Usado no caminho do pacote e no caminho do OPFS; os dois precisam da mesma
 * régua (troca só o que o Windows recusa, remove ponto/espaço no fim).
 *
 * @category helper-puro — sem Vue, sem IndexedDB.
 */
export function safeFileName(name: string, fallback = "arquivo", max = 180): string {
  const cleaned = String(name || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, max);
  return cleaned || fallback;
}
