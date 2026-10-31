/**
 * Pastas que um sincronizador leva para outros computadores (OneDrive,
 * Google Drive, iCloud, Dropbox). Apagar ali apaga nos outros também — a
 * confirmação da Lixeira avisa.
 */
const SYNCED =
  /[\\/](OneDrive[^\\/]*|Google Drive|GoogleDrive[^\\/]*|My Drive|Meu Drive|iCloud Drive|Mobile Documents|Dropbox|CloudStorage)([\\/]|$)/i;

export function isSyncedPath(path: string): boolean {
  return SYNCED.test(path);
}
