import $snackbar from "@/helpers/Snackbar";
import { executeMusic } from "@/helpers/MusicExecution";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { i18nAtual } from "@/i18n";

/**
 * Tocar a música achada na busca pelo teclado — o "digita o número e dá Enter"
 * do LouvorJA clássico. Enter faz o mesmo que o primeiro botão da linha (o
 * cantado; na personalizada que só tem playback, o playback); Shift+Enter, o
 * playback. Sem playback, avisa e não toca: no culto, a voz entrando no lugar
 * do playback que o operador pediu seria pior que nada.
 *
 * @category deve-virar-composable (usa Media e o snackbar do renderer)
 */

export interface QuickPlayItem {
  id_music?: number | string | null;
  custom_song_id?: string | null;
  has_instrumental_music?: boolean | number | null;
  name?: string;
}

function t(key: string, params?: Record<string, unknown>): string {
  const translate = i18nAtual()?.global?.t as
    | ((k: string, p?: Record<string, unknown>) => unknown)
    | undefined;
  const full = `components.quick_play.${key}`;
  return translate ? String(translate(full, params ?? {})) : full;
}

/** Devolve `true` se mandou tocar. */
export function quickPlay(item: QuickPlayItem | null | undefined, playback = false): boolean {
  if (!item) return false;
  const id = Number(item.id_music);
  if (!item.custom_song_id && !(Number.isFinite(id) && id > 0)) return false;
  if (playback && !item.has_instrumental_music) {
    $snackbar.warning(t("no_playback", { name: item.name ?? "" }));
    return false;
  }
  void executeMusic(
    { id_music: id, custom_song_id: item.custom_song_id },
    playback ? MusicActionEnum.INSTRUMENTAL : undefined
  );
  return true;
}

/**
 * Enter de um campo de busca: Shift pede o playback. Ignora a composição de
 * acentos (IME) e a tecla segurada, que repetiria o pedido.
 */
export function isQuickPlayEnter(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.isComposing &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}
