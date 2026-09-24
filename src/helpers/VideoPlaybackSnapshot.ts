import type { VideoMediaState } from "@/types/Media";

export interface VideoPlaybackSnapshot {
  playback_id: string;
  revision: number;
  sampledAt: number;
  position: number;
  playing: boolean;
  rate: number;
  /** Wall-clock time at which position would be zero, while playing. */
  clockAnchor: number | null;
}

/** Captures one coherent media-clock sample for transfer between windows. */
export function createVideoPlaybackSnapshot(
  state: Pick<VideoMediaState, "playback_id" | "revision" | "currentTime" | "isPaused"> & {
    rate?: number;
  },
  sampledAt: number
): VideoPlaybackSnapshot | null {
  if (typeof state.playback_id !== "string" || !state.playback_id) return null;
  if (!Number.isSafeInteger(state.revision) || (state.revision as number) < 1) return null;
  if (!Number.isFinite(state.currentTime) || state.currentTime < 0) return null;
  if (typeof state.isPaused !== "boolean" || !Number.isFinite(sampledAt) || sampledAt < 0) return null;
  const rate = state.rate ?? 1;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const playing = !state.isPaused;
  return {
    playback_id: state.playback_id,
    revision: state.revision as number,
    sampledAt,
    position: state.currentTime,
    playing,
    rate,
    clockAnchor: playing ? sampledAt - (state.currentTime / rate) * 1000 : null,
  };
}

/** Bounds clock extrapolation when a window resumes after a long freeze. */
export function playbackPositionAt(
  snapshot: Pick<VideoPlaybackSnapshot, "sampledAt" | "position" | "playing" | "rate">,
  now: number,
  maxAgeMs = 2000
): number | null {
  if (
    !Number.isFinite(snapshot.position) || snapshot.position < 0 ||
    !Number.isFinite(snapshot.sampledAt) || !Number.isFinite(snapshot.rate) || snapshot.rate <= 0 ||
    typeof snapshot.playing !== "boolean" || !Number.isFinite(now)
  ) return null;
  if (!snapshot.playing) return snapshot.position;
  const ageMs = Math.max(0, Math.min(now - snapshot.sampledAt, maxAgeMs));
  return snapshot.position + (ageMs / 1000) * snapshot.rate;
}

/** Requests from an old projection must never pull state from a newer video. */
export function shouldRespondToVideoStateRequest(
  requestedPlaybackId: unknown,
  activePlaybackId: string | null | undefined,
  isVideoActive: boolean
): boolean {
  return isVideoActive && typeof requestedPlaybackId === "string" &&
    requestedPlaybackId.length > 0 && requestedPlaybackId === activePlaybackId;
}
