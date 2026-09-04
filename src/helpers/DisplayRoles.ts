/**
 * @category helper-puro — Mapa feature → papel de monitor (fachada tipada).
 *
 * A implementação vive em `electron/main/displayRoles.mjs` porque o main
 * process também precisa dela e `src/` não é empacotado no asar. Aqui só damos
 * tipos e uma porta de entrada para o renderer e o web/PWA.
 */

export type DisplayRole = "projection" | "stage" | "operator";

interface DisplayRolesModule {
  ROLES: Record<string, DisplayRole>;
  FEATURE_ROLE: Record<string, DisplayRole>;
  CANONICAL_FEATURE: Record<string, string>;
  /** Papel padrão de uma feature, ou null se ela não for conhecida. */
  roleOfFeature(feature: string): DisplayRole | null;
  deriveRoles(
    prefs: Record<string, number | string | null>,
    resolveId: (raw: number | string | null) => number | null
  ): {
    roles: Record<string, number | null>;
    divergent: Record<string, number>;
    unknown: Record<string, number | string | null>;
  };
}

import * as impl from "@root/electron/main/displayRoles.mjs";

const mod = (impl as { default?: DisplayRolesModule }).default ??
  (impl as unknown as DisplayRolesModule);

export const { ROLES, FEATURE_ROLE, CANONICAL_FEATURE, roleOfFeature, deriveRoles } = mod;

export default mod;
