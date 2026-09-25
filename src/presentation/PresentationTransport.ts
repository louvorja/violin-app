import { MusicPresentationCore, type MusicCommand, type MusicSnapshot } from "./MusicPresentationCore";

/**
 * Ordered in-process adapter around the canonical reducer. Cross-window
 * delivery and late-join recovery use BroadcastPresentationTransport.
 * A snapshot delivery is not a physical frame acknowledgement.
 */
export interface PresentationTransport {
  dispatch(_command: MusicCommand): void;
  subscribe(_listener: (_snapshot: MusicSnapshot) => void): () => void;
  requestSnapshot(): MusicSnapshot;
}

/** Memory adapter used by the music producer and isolated reducer tests. */
export function createMemoryPresentationTransport(core: MusicPresentationCore): PresentationTransport {
  const listeners = new Set<(_snapshot: MusicSnapshot) => void>();
  return {
    dispatch(command) {
      const previous = core.snapshot();
      const snapshot = core.dispatch(command);
      if (snapshot === previous) return;
      for (const listener of [...listeners]) {
        // One observer cannot prevent other observers recovering the commit.
        try { listener(snapshot); } catch { /* observer isolation */ }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    requestSnapshot: () => core.snapshot(),
  };
}
