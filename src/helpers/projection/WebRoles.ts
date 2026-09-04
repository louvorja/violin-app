/**
 * @category helper-puro — Papéis de monitor no navegador.
 *
 * Espelha o que o main process faz no desktop: guarda um retrato de cada
 * monitor por papel e o reconcilia com as telas presentes. Reusa o mesmo
 * algoritmo de identidade, então trocar o projetor de porta continua sendo
 * reconhecido — só que aqui os dados vivem em UserData e as telas vêm da
 * Window Management API.
 */

import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { matchIdentities, type MonitorIdentity } from "@/helpers/MonitorIdentity";
import WebDisplays, { type WebScreen } from "@/helpers/projection/WebDisplays";

export const ROLES = ["projection", "stage", "operator"] as const;
export type Role = (typeof ROLES)[number];

interface RoleEntry {
  state: "resolved" | "none";
  identity: MonitorIdentity | null;
}

export interface WebRoleState {
  role: string;
  status: string;
  reason: string | null;
  displayId: string | null;
}

function _readRoles(): Record<string, RoleEntry> {
  return ($userdata.get(KEYS.OPTIONS.DISPLAYS.ROLES, {}) as Record<string, RoleEntry>) ?? {};
}

function _writeRoles(roles: Record<string, RoleEntry>): void {
  $userdata.set(KEYS.OPTIONS.DISPLAYS.ROLES, roles);
}

/** Telas presentes, no formato que a UI consome. */
export function listDisplays(): {
  id: string;
  number: number;
  name: string;
  label: string;
  bounds: WebScreen["bounds"];
  primary: boolean;
  isInternal: boolean;
}[] {
  return WebDisplays.listScreens().map((screen) => ({
    id: screen.id,
    number: screen.index + 1,
    name: screen.label,
    label: screen.label ? `Monitor ${screen.index + 1} — ${screen.label}` : `Monitor ${screen.index + 1}`,
    bounds: screen.bounds,
    primary: screen.primary,
    isInternal: screen.internal,
  }));
}

/** Reconcilia os papéis salvos com as telas presentes. */
function _resolveAll(): Record<string, { screen: WebScreen | null; status: string }> {
  const saved = _readRoles();
  const screens = WebDisplays.listScreens();
  const candidates = screens.map((s) => WebDisplays.identityOf(s));

  const wanted: Record<string, MonitorIdentity> = {};
  for (const role of ROLES) {
    const entry = saved[role];
    if (entry?.state === "resolved" && entry.identity) wanted[role] = entry.identity;
  }

  const matched = matchIdentities(wanted, candidates);
  const out: Record<string, { screen: WebScreen | null; status: string }> = {};

  for (const role of ROLES) {
    if (!wanted[role]) {
      out[role] = { screen: null, status: "none" };
      continue;
    }
    const result = matched[role];
    if (result?.status === "resolved" && result.candidate) {
      out[role] = { screen: screens[candidates.indexOf(result.candidate)], status: "resolved" };
    } else if (result?.status === "ambiguous") {
      out[role] = { screen: null, status: "ambiguous" };
    } else {
      out[role] = { screen: null, status: "pending" };
    }
  }
  return out;
}

/** Estado de cada papel, para a UI. */
export function rolesSummary(): WebRoleState[] {
  const resolved = _resolveAll();
  return ROLES.map((role) => {
    const entry = resolved[role];
    return {
      role,
      status: entry.status,
      reason: entry.status === "pending" ? "monitor-absent" : null,
      displayId: entry.screen ? entry.screen.id : null,
    };
  });
}

/** Tela atribuída a um papel, ou null quando não há. */
export function screenForRole(role: string): WebScreen | null {
  return _resolveAll()[role]?.screen ?? null;
}

/** Aponta um papel para uma tela. `null` limpa. */
export function setRole(role: string, displayId: string | null): void {
  const roles = { ..._readRoles() };

  if (displayId == null) {
    roles[role] = { state: "none", identity: null };
    _writeRoles(roles);
    return;
  }

  const screen = WebDisplays.listScreens().find((s) => s.id === displayId);
  if (!screen) return;

  roles[role] = { state: "resolved", identity: WebDisplays.identityOf(screen) };
  _writeRoles(roles);
}

export default { ROLES, listDisplays, rolesSummary, screenForRole, setRole };
