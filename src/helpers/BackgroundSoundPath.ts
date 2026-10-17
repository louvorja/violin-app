/**
 * BackgroundSoundPath — URL reproduzível de um som da biblioteca de fundo.
 *
 * Espelha o resolver da liturgia (o caso `som-de-fundo` do `main-shell`) — o
 * único caminho comprovado para registros do `BACKGROUND_SOUND_LIBRARY`:
 * bytes embutidos (`data`+`mime`) viram blob, esquema conhecido passa direto
 * e path de disco vira URL do protocolo `louvorja://`.
 *
 * O blob é criado **a cada chamada e nunca é guardado**: o player
 * (`useBackgroundSound`) revoga a URL ativa em `playFile`, `stop` e
 * `cleanup` (fechar o módulo no desktop). Reaproveitar uma URL antiga
 * significaria dar replay numa URL já revogada — `play()` rejeita em
 * silêncio, `currentFile` fica setado mesmo assim e todos os toques
 * seguintes viram `resume()` contra a mesma src morta: o som "não funciona
 * mais". Com URL nova a cada toque o próprio player segura o teto — só
 * existe uma URL viva por vez (a que está em `_audio.src`).
 */
import Platform from "@/helpers/Platform";
import Path from "@/helpers/Path";

/** Registro do `BACKGROUND_SOUND_LIBRARY` (só os campos que interessam aqui). */
export interface BackgroundSoundRecord {
  path?: string | null;
  data?: ArrayBuffer | Uint8Array | null;
  mime?: string | null;
}

/** Esquemas que o `Audio` entende sem conversão. */
const SCHEME_RE = /^(https?|blob|data|louvorja):/i;

/** Condição de "path inutilizável" — mesma régua da liturgia (sem `blob`/`data`). */
const PLAIN_PATH_RE = /^(https?|louvorja):/i;

export function resolveBackgroundSoundPath(file: BackgroundSoundRecord): string {
  const raw = typeof file.path === "string" ? file.path : "";

  if (file.data && file.mime && (!raw || raw.startsWith("blob:") || !PLAIN_PATH_RE.test(raw))) {
    // Nova URL a cada toque — nunca reutilizar (ver KDoc). O cast acomoda o
    // `Uint8Array<ArrayBufferLike>` do IDB no `BlobPart` genérico do lib.dom.
    return URL.createObjectURL(new Blob([file.data as BlobPart], { type: file.mime }));
  }

  if (!raw) return "";
  if (SCHEME_RE.test(raw)) return raw;
  if (Platform.isDesktop) return Path.local(raw);
  return raw;
}
