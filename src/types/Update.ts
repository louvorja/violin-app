/** Notas de uma release, como a API do GitHub as devolve pelo updater. */
export interface ReleaseNotes {
  version: string;
  name: string;
  body: string;
  bodyHtml: string | null;
  url: string;
}
