/**
 * @category helper-puro — Caminho real de um File escolhido ou arrastado.
 *
 * O Electron 32+ removeu `File.path`; o substituto é `webUtils.getPathForFile`,
 * exposto pelo preload. Na web/PWA o arquivo não tem caminho: devolve "".
 */
import Platform from "@/helpers/Platform";

export function localPathOf(file: File): string {
  return (
    Platform.webUtils?.getPathForFile?.(file) || (file as unknown as { path?: string }).path || ""
  );
}
