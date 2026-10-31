/** Único caminho de "executar a música num modo": botões e menus das listas, Enter das buscas e controle remoto. */
import Media from "@/composables/useMedia";
import { openCustomMusic } from "@/helpers/CustomMusicCatalog";
import { MusicActionEnum } from "@/enums/MusicActionEnum";

export interface ExecutableMusic {
  id_music: number;
  /** UUID da música personalizada: a execução passa a ser por ele. */
  custom_song_id?: string | null;
}

/**
 * Sem modo pedido vale o primeiro botão que a música aceita: no acervo, o
 * cantado; na personalizada, quem decide é o documento — o playback assume
 * quando só ele existe.
 */
export function executeMusic(music: ExecutableMusic, action?: MusicActionEnum): Promise<unknown> {
  if (music.custom_song_id) return openCustomMusic(music.custom_song_id, action);
  const mode = action ?? MusicActionEnum.AUDIO;
  switch (mode) {
    case MusicActionEnum.AUDIO_ONLY:
      return Promise.resolve(Media.openAudio(music.id_music));
    case MusicActionEnum.PLAYBACK_ONLY:
      return Promise.resolve(
        Media.openAudio({ id_music: music.id_music, mode: MusicActionEnum.INSTRUMENTAL })
      );
    case MusicActionEnum.NO_AUDIO:
      return Media.open(music.id_music);
    default:
      return Media.open({ id_music: music.id_music, mode });
  }
}
