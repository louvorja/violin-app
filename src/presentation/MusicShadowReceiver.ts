import { musicSnapshotDifferences, type MusicSlide, type MusicSnapshot } from "./MusicPresentationCore";

export interface MusicShadowPacket {
  version: 1;
  /** Correlation with the authoritative legacy broadcast, not the core revision. */
  legacyRevision: number;
  snapshot: MusicSnapshot;
}

const fields = ["lyric", "cover", "url_image", "image_position", "aux_lyric"] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const counter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function readSlide(value: unknown): MusicSlide | null | undefined {
  if (value === null) return null;
  if (!object(value)) return undefined;
  const slide: Record<string, unknown> = {};
  for (const key of fields) {
    const field = value[key];
    if (field === undefined) continue;
    if (key === "cover") {
      if (typeof field !== "boolean") return undefined;
    } else if (key === "image_position" && typeof field === "number") {
      if (!Number.isFinite(field)) return undefined;
    } else if (typeof field !== "string" || field.length > 100_000) return undefined;
    slide[key] = field;
  }
  return Object.freeze(slide);
}

/** Boundary validation also strips unrelated metadata and nested objects. */
export function readMusicShadowPacket(value: unknown): MusicShadowPacket | null {
  if (!object(value) || value.version !== 1 || !counter(value.legacyRevision) || !object(value.snapshot)) return null;
  const s = value.snapshot;
  if (typeof s.sessionId !== "string" || !s.sessionId.length || s.sessionId.length > 128 ||
      !counter(s.revision) || typeof s.active !== "boolean" ||
      typeof s.title !== "string" || s.title.length > 4096 ||
      !counter(s.slideIndex) || !counter(s.totalSlides)) return null;
  const slide = readSlide(s.slide);
  const nextSlide = readSlide(s.nextSlide);
  if (slide === undefined || nextSlide === undefined) return null;
  if (!s.active && (s.slideIndex !== 0 || s.totalSlides !== 0 || slide !== null || nextSlide !== null || s.title !== "")) return null;
  if (s.active && (s.totalSlides === 0 || s.slideIndex >= s.totalSlides || slide === null ||
      (s.slideIndex + 1 < s.totalSlides) !== (nextSlide !== null))) return null;
  return {
    version: 1, legacyRevision: value.legacyRevision,
    snapshot: Object.freeze({ sessionId: s.sessionId, revision: s.revision, active: s.active,
      title: s.title, slideIndex: s.slideIndex, totalSlides: s.totalSlides, slide, nextSlide }),
  };
}

type LegacySelection = Pick<MusicSnapshot, "title" | "slideIndex" | "totalSlides" | "slide" | "nextSlide" | "active">;

/** Diagnostic receiver: has no setters, commands, DOM or rendering effects. */
export class MusicShadowReceiver {
  private packet: MusicShadowPacket | null = null;
  private legacy: { sessionId: string; revision: number; selection: LegacySelection } | null = null;
  private suspended = false;
  private reportedSession: string | null = null;

  receive(value: unknown): void {
    const packet = readMusicShadowPacket(value);
    if (!packet) return;
    if (this.legacy && packet.snapshot.sessionId !== this.legacy.sessionId) return;
    if (this.packet?.snapshot.sessionId === packet.snapshot.sessionId &&
        (packet.snapshot.revision < this.packet.snapshot.revision || packet.legacyRevision < this.packet.legacyRevision)) return;
    this.packet = packet;
  }

  observe(sessionId: unknown, revision: unknown, selection: LegacySelection): void {
    this.suspended = false;
    if (typeof sessionId !== "string" || !counter(revision)) { this.legacy = null; return; }
    if (this.packet && this.packet.snapshot.sessionId !== sessionId) this.packet = null;
    this.legacy = { sessionId, revision, selection };
  }

  suspend(): void { this.suspended = true; }

  close(): void {
    this.suspended = false;
    if (this.legacy) this.legacy.selection = {
      active: false, title: "", slideIndex: 0, totalSlides: 0, slide: null, nextSlide: null,
    };
  }

  /** At most one metadata-only incident per session in this renderer. */
  takeDifferences(): string[] {
    const packet = this.packet;
    const legacy = this.legacy;
    if (this.suspended || !packet || !legacy || packet.snapshot.sessionId !== legacy.sessionId ||
        packet.legacyRevision !== legacy.revision || packet.snapshot.active !== legacy.selection.active ||
        this.reportedSession === legacy.sessionId) return [];
    const differences = musicSnapshotDifferences(packet.snapshot, legacy.selection);
    if (differences.length) this.reportedSession = legacy.sessionId;
    return differences;
  }

  snapshot(): MusicSnapshot | null { return this.packet?.snapshot ?? null; }
}
