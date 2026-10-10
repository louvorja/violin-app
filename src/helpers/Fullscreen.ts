// Mesmo critério do vue-fullscreen: sem a API (iPhone) ele usa o modo "só página".
export function fullscreenApiAvailable(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}
