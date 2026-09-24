import { normalizeRendererPath } from "@/bootstrap/rendererProfile";

type RouteLocation = Pick<Location, "hash" | "pathname">;

// Apenas essas superfícies foram auditadas como capazes de montar com estado
// de Broadcast/UserData antes do IndexedDB. Rota nova ou desconhecida mantém
// a barreira antiga por segurança, até provar que não precisa de blobs.
const IDB_DEFERRED_ROUTES = new Set([
  "/projection",
  "/projection/return",
  "/obs",
  "/obs/bible",
]);

export function requiresAuxiliaryIndexedDbBeforeMount(location: RouteLocation): boolean {
  return !IDB_DEFERRED_ROUTES.has(normalizeRendererPath(location));
}
