/**
 * ModulePath.ts — helper leve para caminho de módulos em `$appdata.modules.<id>`.
 *
 * Extraído de `Modules.js` para que os manifests dos módulos não precisem
 * importar todo o runtime de módulos (que arrasta AppData, UserData e
 * Telemetry) apenas para montar a string do caminho.
 */
export function getModulePath(moduleId: string): string {
  return `modules.${moduleId}`;
}
