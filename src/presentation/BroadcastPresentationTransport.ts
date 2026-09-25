import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import type { BroadcastSendResult } from "@/helpers/Broadcast";
import { readMusicPresentationPacket, type MusicPresentationPacket } from "./MusicPresentationPacket";

type Message = { type: string; payload?: unknown };

export interface PresentationBroadcastBus {
  send(_type: string, _payload?: unknown): BroadcastSendResult | void;
  listen(_listener: (_message: Message) => void, _options?: { replay?: boolean }): () => void;
}

/** Remote requestSnapshot is asynchronous: subscribers receive the reply. */
export interface BroadcastPresentationTransport {
  publish(_packet: MusicPresentationPacket): "sent" | "invalid_packet" | "broadcast_channel_failed" | "ipc_relay_failed" | "ipc_relay_unavailable" | "disposed";
  subscribe(_listener: (_packet: MusicPresentationPacket) => void): () => void;
  requestSnapshot(): void;
  dispose(): void;
}

/**
 * Cross-window music presentation state. Only an instance with currentSnapshot
 * answers requests. This transport does not own commands or rendering effects.
 */
export function createBroadcastPresentationTransport(
  bus: PresentationBroadcastBus,
  { currentSnapshot }: { currentSnapshot?: () => MusicPresentationPacket | null } = {}
): BroadcastPresentationTransport {
  const observers = new Set<(_packet: MusicPresentationPacket) => void>();
  const retiredSessions = new Set<string>();
  let latest: MusicPresentationPacket | null = null;
  let disposed = false;

  function retire(session: string): void {
    retiredSessions.delete(session);
    retiredSessions.add(session);
    if (retiredSessions.size > 32) retiredSessions.delete(retiredSessions.values().next().value!);
  }

  function accept(value: unknown): void {
    const packet = readMusicPresentationPacket(value);
    if (!packet || retiredSessions.has(packet.snapshot.sessionId)) return;
    if (latest) {
      if (latest.snapshot.sessionId !== packet.snapshot.sessionId) {
        retire(latest.snapshot.sessionId);
      } else {
        // A late-join reply can re-emit the same core selection with a newer
        // compatibility revision/progress envelope. A close advances the
        // core revision without needing a new compatibility slide event.
        if (packet.snapshot.revision < latest.snapshot.revision ||
            packet.selectionRevision < latest.selectionRevision ||
            (packet.snapshot.revision === latest.snapshot.revision &&
              packet.selectionRevision === latest.selectionRevision)) return;
      }
    }
    latest = packet;
    for (const observer of [...observers]) {
      try { observer(packet); } catch { /* one observer cannot block another */ }
    }
    if (!packet.snapshot.active) retire(packet.snapshot.sessionId);
  }

  const stop = bus.listen((message) => {
    if (disposed) return;
    if (message.type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT) {
      accept(message.payload);
    } else if (message.type === BROADCAST_TYPE.REQUEST_MUSIC_PRESENTATION_SNAPSHOT && currentSnapshot) {
      try {
        const packet = readMusicPresentationPacket(currentSnapshot());
        if (packet) bus.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet);
      } catch { /* unavailable producer state: no reply */ }
    }
  // The remote SSE bridge can receive state before the Vue bundle installs
  // this listener. Its validated last packet is the recovery snapshot there.
  }, { replay: true });

  return {
    publish(packet) {
      if (disposed) return "disposed";
      const valid = readMusicPresentationPacket(packet);
      if (!valid) return "invalid_packet";
      try {
        const result = bus.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, valid);
        if (result?.crossWindow === false) return "broadcast_channel_failed";
        if (result?.remoteRelay === "failed") return "ipc_relay_failed";
        if (result?.remoteRelay === "unavailable") return "ipc_relay_unavailable";
        return "sent";
      } catch {
        return "broadcast_channel_failed";
      }
    },
    subscribe(listener) {
      if (disposed) return () => {};
      observers.add(listener);
      if (latest) {
        try { listener(latest); } catch { /* observer isolation */ }
      }
      return () => { observers.delete(listener); };
    },
    requestSnapshot() {
      if (!disposed) bus.send(BROADCAST_TYPE.REQUEST_MUSIC_PRESENTATION_SNAPSHOT);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      observers.clear();
    },
  };
}
