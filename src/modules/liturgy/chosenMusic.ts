import type { LiturgyItem } from "@/types/Liturgy";
import type { SearchMusicItem } from "@/types/Music";

/**
 * O item "Escolher na hora do culto" com a música escolhida, pronto para o
 * `playMusic`. Não é gravado: a liturgia guarda a intenção ("um hino aqui").
 *
 * A música personalizada toca pelo UUID (`ref_id`); o `id_music` negativo dela
 * é só a posição na lista da busca. O `ref_id` é sempre reescrito, porque o
 * item pode trazer o de uma personalizada fixada antes de virar "na hora".
 *
 * @returns `null` quando a música não tem como ser tocada.
 */
export function chosenMusicItem(item: LiturgyItem, music: SearchMusicItem): LiturgyItem | null {
  const id = Number(music.id_music);
  if (!Number.isFinite(id) || id === 0) return null;
  const customSongId = music.custom_song_id || undefined;
  if (id < 0 && !customSongId) return null;
  return { ...item, id_music: id, musica: id, escolha: false, ref_id: customSongId };
}
