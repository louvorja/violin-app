/**
 * Carregamento único do zip.js.
 *
 * O pacote da liturgia e o backup usam streaming; os dois compartilham esta
 * instância. Workers ficam desligados para não depender de CSP/worker no
 * Electron e para o teste rodar no mesmo thread.
 *
 * @category helper-puro — sem Vue, sem IndexedDB.
 */
export type ZipJs = typeof import("@zip.js/zip.js");

let zipModule: Promise<ZipJs> | null = null;

export function loadZipJs(): Promise<ZipJs> {
  zipModule ??= import("@zip.js/zip.js").then((mod) => {
    const api = ((mod as { default?: ZipJs }).default ?? mod) as ZipJs;
    api.configure?.({ useWebWorkers: false });
    return api;
  });
  return zipModule;
}
