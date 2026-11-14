import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { ICONS } from "@/config/Icons";

export interface MusicAction {
  action: MusicActionEnum;
  icon: string;
  color: string;
}

export interface MusicExecution {
  action: MusicActionEnum;
  /** Identificador estável do botão nas listas (`mmt-btn-<id>`). */
  id: string;
  icon: string;
  /** Chave i18n do botão; `menuLabel` é o texto da mesma ação dentro de um menu. */
  label: string;
  menuLabel?: string;
  /** Faixa de que a ação depende; `null` quando ela não toca áudio. */
  track: "sung" | "playback" | null;
  /** Toca só o arquivo de áudio, sem projetar os slides. */
  audioOnly: boolean;
}

/** Modos de executar uma música, na ordem em que as listas e os menus os oferecem. */
export const MUSIC_EXECUTIONS: MusicExecution[] = [
  {
    action: MusicActionEnum.AUDIO,
    id: "sing",
    icon: ICONS.MUSIC.SING,
    label: "ribbon.btn.sing",
    track: "sung",
    audioOnly: false,
  },
  {
    action: MusicActionEnum.INSTRUMENTAL,
    id: "playback",
    icon: ICONS.MUSIC.PLAYBACK,
    label: "ribbon.btn.playback",
    track: "playback",
    audioOnly: false,
  },
  {
    action: MusicActionEnum.NO_AUDIO,
    id: "no-audio",
    icon: ICONS.MUSIC.NO_AUDIO,
    label: "ribbon.btn.no_audio",
    track: null,
    audioOnly: false,
  },
  {
    action: MusicActionEnum.AUDIO_ONLY,
    id: "audio-only",
    icon: ICONS.MUSIC.AUDIO,
    label: "ribbon.btn.audio_only",
    menuLabel: "components.music_menu.file_sing",
    track: "sung",
    audioOnly: true,
  },
  {
    action: MusicActionEnum.PLAYBACK_ONLY,
    id: "playback-only",
    icon: ICONS.MUSIC.AUDIO_PLAYBACK,
    label: "ribbon.btn.playback_only",
    menuLabel: "components.music_menu.file_playback",
    track: "playback",
    audioOnly: true,
  },
];

/** Ícone do modo: o mesmo na linha da música, nos menus, na ribbon, na liturgia e no controle remoto. */
export function musicActionIcon(action: MusicActionEnum): string {
  const execution = MUSIC_EXECUTIONS.find((item) => item.action === action);
  if (!execution) throw new Error(`Modo de execução sem botão: ${action}`);
  return execution.icon;
}

// As chaves `sung`, `pb` e `lyric` são versões da liturgia; o ícone é o do modo que elas tocam.
export const MUSIC_ACTION: Record<string, MusicAction> = {
  [MusicActionEnum.AUDIO]: {
    action: MusicActionEnum.AUDIO,
    icon: musicActionIcon(MusicActionEnum.AUDIO),
    color: "#0034d9",
  },
  [MusicActionEnum.INSTRUMENTAL]: {
    action: MusicActionEnum.INSTRUMENTAL,
    icon: musicActionIcon(MusicActionEnum.INSTRUMENTAL),
    color: "#00560b",
  },
  [MusicActionEnum.LYRIC]: {
    action: MusicActionEnum.LYRIC,
    icon: musicActionIcon(MusicActionEnum.NO_AUDIO),
    color: "#7f8c8d",
  },
  [MusicActionEnum.SUNG]: {
    action: MusicActionEnum.SUNG,
    icon: musicActionIcon(MusicActionEnum.AUDIO),
    color: "#c0392b",
  },
  [MusicActionEnum.PLAYBACK]: {
    action: MusicActionEnum.PLAYBACK,
    icon: musicActionIcon(MusicActionEnum.INSTRUMENTAL),
    color: "#1b4f8a",
  },
  [MusicActionEnum.AUDIO_ONLY]: {
    action: MusicActionEnum.AUDIO_ONLY,
    icon: musicActionIcon(MusicActionEnum.AUDIO_ONLY),
    color: "#27ae60",
  },
  [MusicActionEnum.PLAYBACK_ONLY]: {
    action: MusicActionEnum.PLAYBACK_ONLY,
    icon: musicActionIcon(MusicActionEnum.PLAYBACK_ONLY),
    color: "#8e44ad",
  },
};

/**
 * Versão gravada no item de liturgia → ação do player. Os nomes não coincidem:
 * na liturgia "audio" é tocar só o arquivo; no player é slides com a cantada.
 */
export const LITURGY_VERSION_ACTION: Record<string, MusicActionEnum> = {
  sung: MusicActionEnum.AUDIO,
  pb: MusicActionEnum.INSTRUMENTAL,
  lyric: MusicActionEnum.NO_AUDIO,
  no_audio: MusicActionEnum.NO_AUDIO,
  audio: MusicActionEnum.AUDIO_ONLY,
  audio_pb: MusicActionEnum.PLAYBACK_ONLY,
};

/** O caminho de volta: o botão de execução escolhido → versão que a liturgia toca. */
export const ACTION_LITURGY_VERSION: Partial<Record<MusicActionEnum, string>> = {
  [MusicActionEnum.AUDIO]: "sung",
  [MusicActionEnum.INSTRUMENTAL]: "pb",
  [MusicActionEnum.NO_AUDIO]: "no_audio",
  [MusicActionEnum.AUDIO_ONLY]: "audio",
  [MusicActionEnum.PLAYBACK_ONLY]: "audio_pb",
};

/**
 * A música tem o que a ação precisa. Música feita sem áudio ainda abre pelo
 * "cantado" — entra só com os slides, como no clássico; ele só não vale para a
 * música que é apenas playback, onde abriria os slides em silêncio.
 */
export function canExecute(
  item: MusicExecution,
  tracks: { sung: boolean; playback: boolean }
): boolean {
  if (item.track === null) return true;
  if (item.track === "playback") return tracks.playback;
  return item.audioOnly ? tracks.sung : tracks.sung || !tracks.playback;
}
