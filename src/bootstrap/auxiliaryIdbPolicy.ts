import { normalizeRendererPath } from "@/bootstrap/rendererProfile";

type RouteLocation = Pick<Location, "hash" | "pathname">;

// Essas superfícies reidratam imediatamente blobs/snapshots persistidos no
// IndexedDB. As demais podem montar primeiro e deixar o banco abrir em paralelo
// aos listeners de Broadcast e ao replay de estado.
const IDB_BEFORE_MOUNT_ROUTES = new Set([
  "/projection/file",
  "/projection/file/return",
  "/projection/background_projection",
  "/projection/background_projection/return",
  "/projection/announcements",
]);

export function requiresAuxiliaryIndexedDbBeforeMount(location: RouteLocation): boolean {
  return IDB_BEFORE_MOUNT_ROUTES.has(normalizeRendererPath(location));
}
