/** Ordered announcement decks are owned by the primary shell. */
export interface AnnouncementSlide {
  id: string;
  nome: string;
  ordem: number;
  texto?: string;
  imageData?: ArrayBuffer;
  imageMime?: string;
  videoData?: ArrayBuffer;
  videoMime?: string;
  style?: {
    bgColor?: string;
    textColor?: string;
    fontSize?: number;
    align?: "left" | "center" | "right";
    alignY?: "flex-start" | "center" | "flex-end";
    textShadow?: boolean;
    textShadowColor?: string;
    textShadowBlur?: number;
  };
}

export interface AnnouncementIntent {
  announcement_session: string;
  announcement_epoch: number;
  slides: AnnouncementSlide[];
  index: number;
}

export interface AnnouncementPacket extends AnnouncementIntent {
  announcement_schema: 1;
  announcement_revision: number;
  active: boolean;
}

export type AnnouncementPosition = Pick<AnnouncementPacket,
  "announcement_schema" | "announcement_session" | "announcement_epoch" |
  "announcement_revision" | "index" | "active">;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function validStyle(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  for (const key of ["bgColor", "textColor", "textShadowColor"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 64)) return false;
  }
  for (const key of ["fontSize", "textShadowBlur"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 500)) return false;
  }
  if (value.align !== undefined && !["left", "center", "right"].includes(value.align as string)) return false;
  if (value.alignY !== undefined && !["flex-start", "center", "flex-end"].includes(value.alignY as string)) return false;
  if (value.textShadow !== undefined && typeof value.textShadow !== "boolean") return false;
  return true;
}

let lastIssuedEpoch = 0;
export function beginAnnouncementIntent(): Pick<AnnouncementIntent, "announcement_session" | "announcement_epoch"> {
  lastIssuedEpoch = Math.max(Date.now(), lastIssuedEpoch + 1);
  return {
    announcement_session: globalThis.crypto?.randomUUID?.() ?? `${lastIssuedEpoch}-${Math.random()}`,
    announcement_epoch: lastIssuedEpoch,
  };
}

export function readAnnouncementIntent(value: unknown): AnnouncementIntent | null {
  if (!record(value) || typeof value.announcement_session !== "string" ||
      !value.announcement_session || value.announcement_session.length > 128 ||
      !nonnegative(value.announcement_epoch) || !nonnegative(value.index) ||
      !Array.isArray(value.slides) || value.slides.length === 0 ||
      value.slides.length > 500 || value.index >= value.slides.length) return null;
  const slides: AnnouncementSlide[] = [];
  for (const raw of value.slides) {
    if (!record(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 256 ||
        typeof raw.nome !== "string" || raw.nome.length > 1_000 ||
        !nonnegative(raw.ordem) ||
        (raw.texto !== undefined && (typeof raw.texto !== "string" || raw.texto.length > 100_000)) ||
        (raw.imageData !== undefined && !(raw.imageData instanceof ArrayBuffer)) ||
        (raw.videoData !== undefined && !(raw.videoData instanceof ArrayBuffer)) ||
        (raw.imageMime !== undefined && typeof raw.imageMime !== "string") ||
        (raw.videoMime !== undefined && typeof raw.videoMime !== "string") ||
        !validStyle(raw.style)) return null;
    slides.push(raw as unknown as AnnouncementSlide);
  }
  return {
    announcement_session: value.announcement_session,
    announcement_epoch: value.announcement_epoch,
    slides,
    index: value.index,
  };
}

export function readAnnouncementPacket(value: unknown): AnnouncementPacket | null {
  if (!record(value) || value.announcement_schema !== 1 ||
      !nonnegative(value.announcement_revision) || value.announcement_revision === 0 ||
      typeof value.active !== "boolean") return null;
  const intent = readAnnouncementIntent(value);
  return intent ? { ...intent, announcement_schema: 1,
    announcement_revision: value.announcement_revision, active: value.active } : null;
}

export function readAnnouncementPosition(value: unknown): AnnouncementPosition | null {
  if (!record(value) || value.announcement_schema !== 1 ||
      typeof value.announcement_session !== "string" || !value.announcement_session ||
      value.announcement_session.length > 128 || !nonnegative(value.announcement_epoch) ||
      !nonnegative(value.announcement_revision) || value.announcement_revision === 0 ||
      !nonnegative(value.index) || typeof value.active !== "boolean") return null;
  return {
    announcement_schema: 1,
    announcement_session: value.announcement_session,
    announcement_epoch: value.announcement_epoch,
    announcement_revision: value.announcement_revision,
    index: value.index,
    active: value.active,
  };
}

export function announcementPosition(packet: AnnouncementPacket): AnnouncementPosition {
  const { announcement_schema, announcement_session, announcement_epoch,
    announcement_revision, index, active } = packet;
  return { announcement_schema, announcement_session, announcement_epoch,
    announcement_revision, index, active };
}

export class AnnouncementsPresentationAuthority {
  private currentPacket: AnnouncementPacket | null = null;

  current(): AnnouncementPacket | null { return this.currentPacket; }

  publish(value: unknown): AnnouncementPacket | null {
    const intent = readAnnouncementIntent(value);
    if (!intent) return null;
    const current = this.currentPacket;
    if (current && intent.announcement_epoch < current.announcement_epoch) return null;
    if (current && intent.announcement_epoch === current.announcement_epoch &&
        intent.announcement_session !== current.announcement_session) return null;
    const packet: AnnouncementPacket = { ...intent, announcement_schema: 1,
      announcement_revision: current?.announcement_session === intent.announcement_session
        ? current.announcement_revision + 1 : 1, active: true };
    this.currentPacket = packet;
    return packet;
  }

  control(value: unknown): AnnouncementPacket | null {
    if (!record(value) || typeof value.announcement_session !== "string") return null;
    const current = this.currentPacket;
    if (!current || !current.active || value.announcement_session !== current.announcement_session) return null;
    if (value.action !== "next" && value.action !== "prev" && value.action !== "stop") return null;
    const index = value.action === "next"
      ? Math.min(current.index + 1, current.slides.length - 1)
      : value.action === "prev" ? Math.max(current.index - 1, 0) : current.index;
    if (index === current.index && value.action !== "stop") return null;
    const packet: AnnouncementPacket = { ...current, index,
      active: value.action !== "stop", announcement_revision: current.announcement_revision + 1 };
    this.currentPacket = packet;
    return packet;
  }
}

export class AnnouncementsPresentationGate {
  private last: AnnouncementPacket | null = null;

  accept(value: unknown): AnnouncementPacket | null {
    const packet = readAnnouncementPacket(value);
    if (!packet) return null;
    const last = this.last;
    if (last) {
      if (packet.announcement_epoch < last.announcement_epoch) return null;
      if (packet.announcement_epoch === last.announcement_epoch &&
          packet.announcement_session !== last.announcement_session) return null;
      if (packet.announcement_session === last.announcement_session) {
        if (packet.announcement_revision < last.announcement_revision) return null;
        if (packet.announcement_revision === last.announcement_revision) return last;
      }
    }
    this.last = packet;
    return packet;
  }

  acceptPosition(value: unknown): AnnouncementPacket | null {
    const position = readAnnouncementPosition(value);
    const last = this.last;
    if (!position || !last ||
        position.announcement_session !== last.announcement_session ||
        position.announcement_epoch !== last.announcement_epoch ||
        position.index >= last.slides.length ||
        position.announcement_revision <= last.announcement_revision) return null;
    this.last = { ...last, ...position };
    return this.last;
  }
}
