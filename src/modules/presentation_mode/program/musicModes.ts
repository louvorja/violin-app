import { ICONS } from "@/config/Icons";
import { MusicActionEnum } from "@/enums/MusicActionEnum";

/**
 * Formatos de uma música — os mesmos da liturgia (`subtipo` do item), para o
 * programa importado da liturgia e o criado aqui falarem a mesma língua.
 *
 * Com banda, os slides vão sem música ("Só letra"); sem banda, a música toca
 * ("Cantado" ou "Playback"). "Só áudio" toca sem mandar nada às telas.
 */
export type MusicMode = "sung" | "pb" | "lyric" | "audio" | "audio_pb";

export interface MusicModeOption {
  value: MusicMode;
  /** Chave em `modules.presentation_mode.music_modes.*`. */
  label: string;
  icon: string;
  needsInstrumental: boolean;
}

export const MUSIC_MODES: readonly MusicModeOption[] = Object.freeze([
  { value: "sung", label: "music_modes.sung", icon: ICONS.MUSIC.SING, needsInstrumental: false },
  { value: "pb", label: "music_modes.pb", icon: ICONS.MUSIC.PLAYBACK, needsInstrumental: true },
  { value: "lyric", label: "music_modes.lyric", icon: ICONS.MUSIC.NO_AUDIO, needsInstrumental: false },
  { value: "audio", label: "music_modes.audio", icon: ICONS.MUSIC.AUDIO, needsInstrumental: false },
  { value: "audio_pb", label: "music_modes.audio_pb", icon: ICONS.MUSIC.AUDIO_PLAYBACK, needsInstrumental: true },
]);

export function modesFor(hasInstrumental: boolean): MusicModeOption[] {
  return MUSIC_MODES.filter((m) => hasInstrumental || !m.needsInstrumental);
}

export function isMusicMode(value: string | undefined): value is MusicMode {
  return MUSIC_MODES.some((m) => m.value === value);
}

/** Ação dos botões de música do app → formato do módulo. A letra avulsa não é formato. */
const MODE_OF_ACTION: Partial<Record<MusicActionEnum, MusicMode>> = {
  [MusicActionEnum.AUDIO]: "sung",
  [MusicActionEnum.INSTRUMENTAL]: "pb",
  [MusicActionEnum.NO_AUDIO]: "lyric",
  [MusicActionEnum.AUDIO_ONLY]: "audio",
  [MusicActionEnum.PLAYBACK_ONLY]: "audio_pb",
};

export function modeOfAction(action: MusicActionEnum): MusicMode | null {
  return MODE_OF_ACTION[action] ?? null;
}
