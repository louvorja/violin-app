import type { VideoMediaState } from "@/types/Media";

function validPlaybackId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

/** Gera revisões monotônicas, reiniciadas apenas quando muda o playback. */
export class VideoStateRevisionCounter {
  private playbackId: string | null = null;
  private revision = 0;

  next(
    playbackId: string | null | undefined
  ): Pick<VideoMediaState, "playback_id" | "revision"> | null {
    if (!validPlaybackId(playbackId)) return null;
    if (playbackId !== this.playbackId) {
      this.playbackId = playbackId;
      this.revision = 0;
    }
    this.revision += 1;
    return { playback_id: playbackId, revision: this.revision };
  }

  reset(): void {
    this.playbackId = null;
    this.revision = 0;
  }
}

/**
 * Protege um consumidor contra pacotes atrasados e fora de ordem.
 *
 * Payloads legados (sem playback_id e sem revision) continuam aceitos até o
 * primeiro payload versionado válido da projeção atual. Depois desse ponto o
 * consumidor não volta ao protocolo ambíguo. Payload parcialmente versionado é
 * inválido e nunca entra pela exceção de compatibilidade.
 */
export class VideoStateGate {
  private expectedPlaybackId: string | null = null;
  private versioned = false;
  private lastRevision = 0;

  begin(playbackId?: string | null): void {
    const expected = validPlaybackId(playbackId) ? playbackId : null;
    // Replays do mesmo FILE_PROJECTION não devem zerar a monotonicidade.
    if (expected && expected === this.expectedPlaybackId) return;
    this.expectedPlaybackId = expected;
    this.versioned = false;
    this.lastRevision = 0;
  }

  clear(): void {
    this.expectedPlaybackId = null;
    this.versioned = false;
    this.lastRevision = 0;
  }

  accepts(state: VideoMediaState | null | undefined): boolean {
    if (!state || typeof state !== "object") return false;
    const hasPlaybackId = state.playback_id !== undefined;
    const hasRevision = state.revision !== undefined;

    // Se FILE_PROJECTION ja anunciou a identidade, um pacote legado e
    // ambiguo: ele pode pertencer justamente ao playback anterior. O modo
    // legado so existe enquanto a propria projecao tambem nao tem identidade.
    if (!hasPlaybackId && !hasRevision) {
      return !this.versioned && this.expectedPlaybackId === null;
    }
    if (!validPlaybackId(state.playback_id) || !validRevision(state.revision)) return false;
    if (this.expectedPlaybackId && state.playback_id !== this.expectedPlaybackId) return false;
    if (this.versioned && state.revision <= this.lastRevision) return false;

    this.expectedPlaybackId = state.playback_id;
    this.versioned = true;
    this.lastRevision = state.revision;
    return true;
  }
}
