/** Generic text/timer/draw state has one ordered stream per module. */
export interface ModuleValue {
  module: string;
  text?: string;
  reference?: string | string[];
  active?: boolean;
  color?: string;
  extra?: string;
}

export interface ModulePresentationPacket extends ModuleValue {
  module_schema: 1;
  module_session: string;
  module_epoch: number;
  module_revision: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const counter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function readModuleValue(value: unknown): ModuleValue | null {
  if (!record(value) || typeof value.module !== "string" ||
      !/^[a-z0-9_]{1,64}$/.test(value.module)) return null;
  const result: ModuleValue = { module: value.module };
  for (const key of ["text", "color", "extra"] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || field.length > (key === "text" ? 20_000 : 1_000)) return null;
    result[key] = field;
  }
  if (value.reference !== undefined) {
    if (typeof value.reference === "string" && value.reference.length <= 4_096) {
      result.reference = value.reference;
    } else if (Array.isArray(value.reference) && value.reference.length <= 1_000 &&
        value.reference.every((item) => typeof item === "string" && item.length <= 256)) {
      result.reference = [...value.reference];
    } else return null;
  }
  if (value.active !== undefined) {
    if (typeof value.active !== "boolean") return null;
    result.active = value.active;
  }
  return result;
}

export function readModulePresentationPacket(value: unknown): ModulePresentationPacket | null {
  if (!record(value) || value.module_schema !== 1 ||
      typeof value.module_session !== "string" || !value.module_session ||
      value.module_session.length > 128 || !counter(value.module_epoch) ||
      !counter(value.module_revision) || value.module_revision === 0) return null;
  const state = readModuleValue(value);
  return state ? {
    ...state,
    module_schema: 1,
    module_session: value.module_session,
    module_epoch: value.module_epoch,
    module_revision: value.module_revision,
  } : null;
}

export class ModulePresentationAuthority {
  readonly session: string;
  readonly epoch: number;
  private revisions = new Map<string, number>();

  constructor(now = Date.now(), id: string = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) {
    this.epoch = now;
    this.session = `${now.toString(36)}-${id}`;
  }

  publish(intent: unknown): ModulePresentationPacket | null {
    const state = readModuleValue(intent);
    if (!state) return null;
    const revision = (this.revisions.get(state.module) ?? 0) + 1;
    this.revisions.set(state.module, revision);
    return {
      ...state,
      module_schema: 1,
      module_session: this.session,
      module_epoch: this.epoch,
      module_revision: revision,
    };
  }
}

export class ModulePresentationGate {
  private last = new Map<string, ModulePresentationPacket>();

  accept(value: unknown): ModulePresentationPacket | null {
    const packet = readModulePresentationPacket(value);
    if (!packet) return null;
    const last = this.last.get(packet.module);
    if (last) {
      if (packet.module_epoch < last.module_epoch) return null;
      if (packet.module_epoch === last.module_epoch && packet.module_session !== last.module_session &&
          packet.module_session < last.module_session) return null;
      if (packet.module_session === last.module_session) {
        if (packet.module_revision < last.module_revision) return null;
        if (packet.module_revision === last.module_revision &&
            JSON.stringify(packet) !== JSON.stringify(last)) return null;
      }
    }
    this.last.set(packet.module, packet);
    return packet;
  }
}
