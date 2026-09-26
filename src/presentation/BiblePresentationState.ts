/** The primary shell is the sole publisher of versioned Bible state. */
export interface BibleVerseState {
  text: string;
  reference: string;
  active: boolean;
  book?: string;
  book_id?: number;
  chapter?: number;
  verses?: number[];
  version?: string;
  version_id?: number;
  next_text?: string;
  next_reference?: string;
}

export interface BiblePresentationPacket extends BibleVerseState {
  bible_schema: 1;
  bible_session: string;
  bible_epoch: number;
  bible_revision: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const positiveInteger = (value: unknown): value is number =>
  nonnegativeInteger(value) && value > 0;
const readPositiveInteger = (value: unknown): number | null => {
  if (positiveInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (positiveInteger(parsed)) return parsed;
  }
  return null;
};

/** Validate and strip remote/IPC fields before they become stage content. */
export function readBibleVerseState(value: unknown): BibleVerseState | null {
  if (!isRecord(value) || typeof value.active !== "boolean" ||
      typeof value.text !== "string" || value.text.length > 100_000 ||
      typeof value.reference !== "string" || value.reference.length > 4_096) return null;
  const result: BibleVerseState = {
    text: value.text,
    reference: value.reference,
    active: value.active,
  };
  for (const key of ["book", "version", "next_text", "next_reference"] as const) {
    const field = value[key];
    if (field === undefined || field === null) continue;
    if (typeof field !== "string" || field.length > (key === "next_text" ? 100_000 : 4_096)) return null;
    result[key] = field;
  }
  for (const key of ["book_id", "chapter", "version_id"] as const) {
    const field = value[key];
    if (field === undefined || field === null) continue;
    const parsed = readPositiveInteger(field);
    if (parsed === null) return null;
    result[key] = parsed;
  }
  if (value.verses !== undefined && value.verses !== null) {
    if (!Array.isArray(value.verses) || value.verses.length > 200) return null;
    const verses = value.verses.map(readPositiveInteger);
    if (verses.some((verse) => verse === null)) return null;
    result.verses = verses as number[];
  }
  return result;
}

export function readBiblePresentationPacket(value: unknown): BiblePresentationPacket | null {
  if (!isRecord(value) || value.bible_schema !== 1 ||
      typeof value.bible_session !== "string" || !value.bible_session ||
      value.bible_session.length > 128 || !nonnegativeInteger(value.bible_epoch) ||
      !positiveInteger(value.bible_revision)) return null;
  const state = readBibleVerseState(value);
  return state ? {
    ...state,
    bible_schema: 1,
    bible_session: value.bible_session,
    bible_epoch: value.bible_epoch,
    bible_revision: value.bible_revision,
  } : null;
}

/** One shell lifetime owns a session; every selection or close advances revision. */
export class BiblePresentationAuthority {
  readonly session: string;
  readonly epoch: number;
  private revision = 0;

  constructor(now = Date.now(), id: string = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) {
    this.epoch = now;
    this.session = `${now.toString(36)}-${id}`;
  }

  publish(intent: unknown): BiblePresentationPacket | null {
    const state = readBibleVerseState(intent);
    if (!state) return null;
    return {
      ...state,
      bible_schema: 1,
      bible_session: this.session,
      bible_epoch: this.epoch,
      bible_revision: ++this.revision,
    };
  }
}

/** Accept exact snapshot re-publication, never older or conflicting state. */
export class BiblePresentationGate {
  private last: BiblePresentationPacket | null = null;

  accept(value: unknown): BiblePresentationPacket | null {
    const packet = readBiblePresentationPacket(value);
    if (!packet) return null;
    const last = this.last;
    if (last) {
      if (packet.bible_epoch < last.bible_epoch) return null;
      if (packet.bible_epoch === last.bible_epoch && packet.bible_session !== last.bible_session &&
          packet.bible_session < last.bible_session) return null;
      if (packet.bible_session === last.bible_session) {
        if (packet.bible_revision < last.bible_revision) return null;
        if (packet.bible_revision === last.bible_revision &&
            JSON.stringify(packet) !== JSON.stringify(last)) return null;
      }
    }
    this.last = packet;
    return packet;
  }
}
