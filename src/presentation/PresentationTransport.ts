import { MusicPresentationCore, type MusicCommand, type MusicSnapshot } from "./MusicPresentationCore";

/**
 * First transport slice: an ordered, in-process authority and its observers.
 * Subscription is live-only; requestSnapshot recovers after a missed update.
 * No connect/reportApplied yet: the shadow has no remote renderer to connect
 * or acknowledge, and must not claim that a diagnostic snapshot was painted.
 */
export interface PresentationTransport {
  dispatch(_command: MusicCommand): void;
  subscribe(_listener: (_snapshot: MusicSnapshot) => void): () => void;
  requestSnapshot(): MusicSnapshot;
}

/** Memory adapter used by the actual music shadow producer, also usable in tests. */
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
