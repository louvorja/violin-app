/** Runtime identity lives outside the deterministic presentation core. */
export function createMusicPresentationSessionFactory(): () => string {
  const instance = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  let sequence = 0;
  return () => `music-${instance}-${++sequence}`;
}
