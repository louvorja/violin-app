import { ICONS } from "@/config/Icons";
import type { ProgramItemKind } from "@/types/Presentation";

export const KIND_ICONS: Readonly<Record<ProgramItemKind, string>> = Object.freeze({
  music: ICONS.MUSIC.MUSIC,
  video: ICONS.MEDIA.VIDEO_FILE,
  online_video: ICONS.MEDIA.YOUTUBE,
  image: ICONS.MEDIA.IMAGE,
  audio: ICONS.MUSIC.PLAYBACK,
  file: ICONS.UI.FILE,
  presentation: ICONS.PROJECTION.PRESENTATION,
  bible: ICONS.MODULES.BIBLE,
  announcements: ICONS.MODULES.ANNOUNCEMENTS,
  note: ICONS.UI.NOTE_TEXT,
  site: ICONS.UI.WEB,
  overlay: ICONS.UI.LAYERS,
  scheduled: ICONS.CALENDAR.MULTISELECT,
  moment: ICONS.MEDIA.PLAYLIST,
});

/** Tipos que o diálogo de "Novo item" sabe criar; os demais chegam pela liturgia. */
export const CREATABLE_KINDS = ["music", "bible", "file", "moment", "online_video", "note"] as const;
export type CreatableKind = (typeof CREATABLE_KINDS)[number];
