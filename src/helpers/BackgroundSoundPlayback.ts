/**
 * BackgroundSoundPlayback — tocar um registro da biblioteca e o som padrão.
 *
 * Uma implementação para todos os gatilhos: o controle remoto
 * (`play`/`play-default`) e o botão "Tocar" da guia do módulo.
 *
 * @category deve-virar-composable — Usa UserData (Pinia) e o player; requer renderer.
 */
import $userdata from "@/helpers/UserData";
import $idb from "@/helpers/IndexedDB";
import { KEYS } from "@/constants/UserDataKeys";
import { DB_TABLE } from "@/constants/DbTables";
import { useBackgroundSound } from "@/composables/useBackgroundSound";
import { resolveBackgroundSoundPath } from "@/helpers/BackgroundSoundPath";
import type { MediaFile } from "@/types/Media";

export type DefaultSoundOutcome =
  /** Nenhum som marcado como padrão (ou o marcado saiu da biblioteca). */
  | "missing"
  /** O padrão já está tocando: não reinicia. */
  | "already_playing"
  /** Estava pausado no próprio padrão: continua de onde parou. */
  | "resumed"
  | "started"
  /** O registro existe, mas não tem bytes nem caminho. */
  | "unplayable";

/**
 * Toca um registro da biblioteca no player único, com o fade-in configurado.
 *
 * O caminho vem de `resolveBackgroundSoundPath`: URL nova a cada toque — o
 * player revoga a URL ativa em `playFile`/`stop`/`cleanup`, e reaproveitar uma
 * antiga dava replay de URL revogada.
 *
 * @returns `false` quando o registro não tem o que tocar
 */
export function playBackgroundSoundRecord(record: MediaFile): boolean {
  const bg = useBackgroundSound();
  const path = resolveBackgroundSoundPath(record);
  // Tocar com src vazio setaria `currentFile` com o play falhando, e os
  // próximos toques virariam resume() contra um src morto.
  if (!path) {
    console.warn("[background_sound] som sem caminho reproduzível:", record?.id);
    bg.unplayableFile.value = record;
    return false;
  }
  bg.playFile({ ...record, path }, bg.fadeInMs.value);
  return true;
}

/** Inicia o som marcado como padrão; idempotente quando ele já está no ar. */
export async function playDefaultBackgroundSound(): Promise<DefaultSoundOutcome> {
  const bg = useBackgroundSound();
  const defaultId = String($userdata.get(KEYS.MODULES.BACKGROUND_SOUND.DEFAULT_ID, "") || "");
  const record = defaultId
    ? await $idb.get<MediaFile>(DB_TABLE.BACKGROUND_SOUND_LIBRARY, defaultId)
    : null;
  if (!record) return "missing";

  if (String(bg.currentFile.value?.id) === String(record.id)) {
    if (bg.isPlaying.value) return "already_playing";
    bg.resume();
    return "resumed";
  }
  return playBackgroundSoundRecord(record) ? "started" : "unplayable";
}
