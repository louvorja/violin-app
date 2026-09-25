import type { MusicSnapshot } from "./MusicPresentationCore";

/** Fields consumed by the music projection, return, OBS, Operator and Libras. */
export interface PresentationSlide {
  lyric?: string | null;
  name?: string | null;
  aux_lyric?: string | null;
  lyric_aux?: string | null;
  url_image?: string | null;
  image_position?: string | number | null;
  cover?: boolean | null;
  is_cover?: boolean | null;
  tipo?: string | null;
  color?: string | null;
  color_aux?: string | null;
  font?: string | null;
  font_size_pct?: number | null;
  font_size_aux_pct?: number | null;
  id_music?: string | number | null;
}

export type MusicPresentationSnapshot = Omit<MusicSnapshot, "slide" | "nextSlide"> & {
  readonly slide: Readonly<PresentationSlide> | null;
  readonly nextSlide: Readonly<PresentationSlide> | null;
};

export interface MusicPresentationPacket {
  readonly schema: 1;
  /** Monotone emission revision for progress and late-join re-publications. */
  readonly selectionRevision: number;
  readonly playbackId?: string;
  readonly progress: number;
  readonly slideProgress: number;
  readonly emittedAt: number;
  readonly commandAt?: number;
  readonly commitAt?: number;
  readonly snapshot: MusicPresentationSnapshot;
}

const textFields = ["lyric", "name", "aux_lyric", "lyric_aux", "url_image", "tipo", "color", "color_aux", "font"] as const;
const booleanFields = ["cover", "is_cover"] as const;
const numberFields = ["font_size_pct", "font_size_aux_pct"] as const;
const maxTextLength: Record<(typeof textFields)[number], number> = {
  lyric: 100_000,
  name: 4_096,
  aux_lyric: 100_000,
  lyric_aux: 100_000,
  url_image: 8_192,
  tipo: 64,
  color: 128,
  color_aux: 128,
  font: 256,
};
const MAX_PACKET_CHARACTERS = 512_000;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const counter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const percent = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

/** Guard every remote music mutation against a session already replaced/closed. */
export function musicCommandSessionRejectionReason(
  current: Pick<MusicSnapshot, "active" | "sessionId"> | null,
  session: unknown
): "invalid_session" | "stale_or_missing_session" | null {
  if (session !== undefined &&
      (typeof session !== "string" || !session || session.length > 128)) return "invalid_session";
  if (current?.active ? session !== current.sessionId : session !== undefined) {
    return "stale_or_missing_session";
  }
  return null;
}

function readSlide(value: unknown): { slide: Readonly<PresentationSlide> | null; characters: number } | null {
  if (value === null) return { slide: null, characters: 0 };
  if (!object(value)) return null;
  const slide: Record<string, string | number | boolean | null> = {};
  let characters = 0;
  for (const key of textFields) {
    const field = value[key];
    if (field === undefined) continue;
    if (field !== null && (typeof field !== "string" || field.length > maxTextLength[key])) return null;
    slide[key] = field;
    if (typeof field === "string") characters += field.length;
  }
  for (const key of booleanFields) {
    const field = value[key];
    if (field === undefined) continue;
    if (field !== null && typeof field !== "boolean") return null;
    slide[key] = field;
  }
  for (const key of numberFields) {
    const field = value[key];
    if (field === undefined) continue;
    if (field !== null && (typeof field !== "number" || !Number.isFinite(field) || field < 0 || field > 1_000)) return null;
    slide[key] = field;
  }
  const position = value.image_position;
  if (position !== undefined) {
    if (position !== null && !(
      (typeof position === "string" && position.length <= 128) ||
      (typeof position === "number" && Number.isFinite(position) && Math.abs(position) <= 1_000)
    )) return null;
    slide.image_position = position;
    if (typeof position === "string") characters += position.length;
  }
  const musicId = value.id_music;
  if (musicId !== undefined) {
    if (musicId !== null && !(
      (typeof musicId === "string" && musicId.length > 0 && musicId.length <= 128) ||
      (typeof musicId === "number" && Number.isSafeInteger(musicId) && musicId >= 0)
    )) return null;
    slide.id_music = musicId;
    if (typeof musicId === "string") characters += musicId.length;
  }
  return { slide: Object.freeze(slide), characters };
}

/** Validate a network/IPC packet and strip unrelated or nested slide metadata. */
export function readMusicPresentationPacket(value: unknown): MusicPresentationPacket | null {
  if (!object(value) || value.schema !== 1 || !object(value.snapshot)) return null;
  if (!counter(value.selectionRevision) || !percent(value.progress) ||
      !percent(value.slideProgress) || !counter(value.emittedAt) ||
      (value.playbackId !== undefined && (typeof value.playbackId !== "string" || value.playbackId.length > 128)) ||
      (value.commandAt !== undefined && (!counter(value.commandAt) || value.commandAt > value.emittedAt)) ||
      (value.commitAt !== undefined && (!counter(value.commitAt) || value.commitAt > value.emittedAt))) return null;
  const s = value.snapshot;
  if (typeof s.sessionId !== "string" || !s.sessionId.length || s.sessionId.length > 128 ||
      !counter(s.revision) || typeof s.active !== "boolean" ||
      typeof s.title !== "string" || s.title.length > 4_096 ||
      !counter(s.slideIndex) || !counter(s.totalSlides)) return null;
  const current = readSlide(s.slide);
  const next = readSlide(s.nextSlide);
  if (!current || !next ||
      s.title.length + current.characters + next.characters > MAX_PACKET_CHARACTERS) return null;
  if (!s.active && (s.slideIndex !== 0 || s.totalSlides !== 0 ||
      current.slide !== null || next.slide !== null || s.title !== "")) return null;
  if (s.active && (s.totalSlides === 0 || s.slideIndex >= s.totalSlides ||
      current.slide === null || (s.slideIndex + 1 < s.totalSlides) !== (next.slide !== null))) return null;
  return Object.freeze({
    schema: 1,
    selectionRevision: value.selectionRevision,
    ...(value.playbackId === undefined ? {} : { playbackId: value.playbackId }),
    progress: value.progress,
    slideProgress: value.slideProgress,
    emittedAt: value.emittedAt,
    ...(value.commandAt === undefined ? {} : { commandAt: value.commandAt }),
    ...(value.commitAt === undefined ? {} : { commitAt: value.commitAt }),
    snapshot: Object.freeze({
      sessionId: s.sessionId,
      revision: s.revision,
      active: s.active,
      title: s.title,
      slideIndex: s.slideIndex,
      totalSlides: s.totalSlides,
      slide: current.slide,
      nextSlide: next.slide,
    }),
  });
}
