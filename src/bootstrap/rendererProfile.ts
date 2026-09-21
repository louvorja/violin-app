export type RendererProfile = "shell" | "projection" | "auxiliary";

const PROJECTION_PREFIXES = ["/projection", "/projecao", "/obs", "/clock", "/relogio"];
const AUXILIARY_PREFIXES = ["/operator", "/popup", "/remote"];

export function normalizeRendererPath(location: Pick<Location, "hash" | "pathname">): string {
  const hashPath = location.hash.replace(/^#/, "").split("?")[0];
  return hashPath || location.pathname || "/";
}

/**
 * Perfis de renderer são decididos antes de importar o bootstrap:
 * - shell: operador principal e serviços globais;
 * - projection: superfícies de projeção/OBS, sem UI de operador;
 * - auxiliary: popup, operador secundário e controle remoto.
 */
export function getRendererProfile(
  location: Pick<Location, "hash" | "pathname">
): RendererProfile {
  const path = normalizeRendererPath(location);
  if (PROJECTION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return "projection";
  }
  if (AUXILIARY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return "auxiliary";
  }
  return "shell";
}
