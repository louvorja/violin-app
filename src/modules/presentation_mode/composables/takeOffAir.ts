import $userdata from "@/helpers/UserData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import Media from "@/composables/useMedia";
import { useFileProjection } from "@/composables/useFileProjection";
import type { LiveKind } from "./useLiveContent";

/**
 * Tira do ar o que está na tela principal — a música, o versículo, o arquivo,
 * o vídeo, os anúncios — sem fechar as janelas de projeção: a tela volta ao
 * fundo e a apresentação continua de pé para o próximo item.
 */
export function takeOffAir(kind: LiveKind | null): void {
  switch (kind) {
    case "music":
    case "file":
    case "online_video":
      Media.close(true, false, true);
      break;
    case "bible":
      $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, false);
      Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE_INTENT, { text: "", reference: "", active: false });
      break;
    case "announcements":
      useFileProjection().stopProjection();
      break;
  }
}

/**
 * O que está no ar, para o "Tirar do ar": tudo o que está sendo reproduzido —
 * na tela principal, só no retorno ou só na faixa de áudio. Um hino em "só
 * áudio" não aparece em tela nenhuma, mas a igreja está ouvindo.
 */
export interface AirState {
  kind: LiveKind | null;
  returnOnly: boolean;
  audio: boolean;
}

export function hasAnythingOnAir(state: AirState): boolean {
  return !!state.kind || state.returnOnly || state.audio;
}
