/**
 * @category helper-puro — Identidade estável de monitores (fachada tipada).
 *
 * A implementação vive em `electron/main/monitorIdentity.mjs` porque o main
 * process precisa dela e `src/` não é empacotado no asar (ver
 * `electron-builder.yml`). Aqui só damos tipos e uma porta de entrada ESM para
 * o renderer e o web/PWA.
 */

export interface MonitorSize {
  w: number;
  h: number;
}

export interface MonitorPoint {
  x: number;
  y: number;
}

/** Retrato de um monitor. Schema fixo: todo campo está sempre presente. */
export interface MonitorIdentity {
  source: "electron" | "web" | null;
  label: string;
  px: MonitorSize | null;
  dip: MonitorSize | null;
  scaleFactor: number | null;
  rotation: number | null;
  internal: boolean | null;
  nativeOrigin: MonitorPoint | null;
  index: number | null;
  primary: boolean | null;
  nativeId: number | null;
}

export type MatchStatus = "resolved" | "ambiguous" | "unmatched";

export interface MatchResult {
  status: MatchStatus;
  candidate: MonitorIdentity | null;
  score: number;
}

export interface ScoreResult {
  score: number;
  veto: string | null;
  available: number;
  earned: number;
}

interface MonitorIdentityModule {
  WEIGHTS: Record<string, number>;
  ASPECT_ONLY_POINTS: number;
  ACCEPT_THRESHOLD: number;
  MARGIN: number;
  emptyIdentity(): MonitorIdentity;
  identityFromDisplay(display: unknown, index: number): MonitorIdentity;
  vetoReason(saved: MonitorIdentity, candidate: MonitorIdentity): string | null;
  scoreIdentity(saved: MonitorIdentity, candidate: MonitorIdentity): ScoreResult;
  matchIdentity(saved: MonitorIdentity, candidates: MonitorIdentity[]): MatchResult;
  matchIdentities(
    savedByKey: Record<string, MonitorIdentity>,
    candidates: MonitorIdentity[]
  ): Record<string, MatchResult>;
}

import * as impl from "@root/electron/main/monitorIdentity.mjs";

const mod = (impl as { default?: MonitorIdentityModule }).default ??
  (impl as unknown as MonitorIdentityModule);

export const {
  WEIGHTS,
  ASPECT_ONLY_POINTS,
  ACCEPT_THRESHOLD,
  MARGIN,
  emptyIdentity,
  identityFromDisplay,
  vetoReason,
  scoreIdentity,
  matchIdentity,
  matchIdentities,
} = mod;

export default mod;
