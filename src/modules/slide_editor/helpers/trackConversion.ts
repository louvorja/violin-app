import type { CustomSlide, CustomSong } from "@/helpers/CustomSongs";

export interface TrackConversionResult {
  audio_token: string;
  audio_name: string;
  playback_token?: string;
  playback_name?: string;
  slides: CustomSlide[];
  nextIsPlayback: boolean;
}

/**
 * Converte a faixa em edição (Cantado <-> Playback) preservando áudio e tempos
 * gravados. Se ambas as faixas tiverem áudio, troca-as entre si com os
 * respectivos tempos; se a faixa de destino estiver vazia, move áudio e tempos
 * para ela e zera os tempos da origem.
 */
export function convertActiveTrack(
  song: Pick<CustomSong, "audio_token" | "audio_name" | "playback_token" | "playback_name" | "slides">,
  currentIsPlayback: boolean
): TrackConversionResult {
  const sungToken = song.audio_token || "";
  const sungName = song.audio_name || "";
  const pbToken = song.playback_token || "";
  const pbName = song.playback_name || "";
  const sourceHasAudio = currentIsPlayback ? !!pbToken : !!sungToken;
  const targetHasAudio = currentIsPlayback ? !!sungToken : !!pbToken;
  const swapBoth = sourceHasAudio && targetHasAudio;

  const slides: CustomSlide[] = (song.slides || []).map((slide) => {
    const sungTime = Number(slide.tempo_seconds) || 0;
    const pbTime =
      slide.tempo_seconds_pb !== undefined ? Number(slide.tempo_seconds_pb) || 0 : sungTime;
    const copy: CustomSlide = { ...slide };

    if (swapBoth) {
      copy.tempo_seconds = pbTime;
      copy.tempo_seconds_pb = sungTime;
      return copy;
    }

    if (currentIsPlayback) {
      // Playback -> Cantado (sem faixa cantada prévia): tempos viram `tempo_seconds`.
      copy.tempo_seconds = pbTime;
      delete copy.tempo_seconds_pb;
      return copy;
    }

    // Cantado -> Playback (sem playback prévio): tempos vão para `tempo_seconds_pb`.
    copy.tempo_seconds = 0;
    if (sungTime > 0) copy.tempo_seconds_pb = sungTime;
    else delete copy.tempo_seconds_pb;
    return copy;
  });

  if (currentIsPlayback) {
    return {
      audio_token: pbToken,
      audio_name: pbName,
      playback_token: swapBoth ? sungToken : "",
      playback_name: swapBoth ? sungName : "",
      slides,
      nextIsPlayback: false,
    };
  }

  return {
    audio_token: swapBoth ? pbToken : "",
    audio_name: swapBoth ? pbName : "",
    playback_token: sungToken,
    playback_name: sungName,
    slides,
    nextIsPlayback: true,
  };
}
