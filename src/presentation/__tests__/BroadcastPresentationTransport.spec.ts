import { describe, expect, it, vi } from "vitest";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { createBroadcastPresentationTransport, type PresentationBroadcastBus } from "../BroadcastPresentationTransport";
import { readMusicPresentationPacket, type MusicPresentationPacket } from "../MusicPresentationPacket";

function packet(sessionId = "song-a", revision = 1, lyric = "Verse"): MusicPresentationPacket {
  const value = readMusicPresentationPacket({
    schema: 1, selectionRevision: revision, progress: 20, slideProgress: 40, emittedAt: 1_000,
    snapshot: {
      sessionId, revision, active: true, title: "Song", slideIndex: 1, totalSlides: 2,
      slide: {
        lyric, name: "Alternate name", aux_lyric: "Aux", lyric_aux: "Legacy aux",
        url_image: "images/verse.jpg", image_position: 4, cover: false,
        is_cover: false, tipo: "LETRA", color: "#fff", color_aux: "#aaa",
        font: "Inter", font_size_pct: 14, font_size_aux_pct: 10, id_music: 42,
      },
      nextSlide: null,
    },
  });
  if (!value) throw new Error("invalid fixture");
  return value;
}

function hub() {
  const windows = new Set<Set<(_message: { type: string; payload?: unknown }) => void>>();
  const sent: Array<{ type: string; payload?: unknown }> = [];
  function windowBus(): PresentationBroadcastBus {
    const listeners = new Set<(_message: { type: string; payload?: unknown }) => void>();
    windows.add(listeners);
    return {
      send(type, payload) {
        const message = { type, payload };
        sent.push(message);
        for (const targets of windows) for (const listener of [...targets]) listener(message);
      },
      listen(listener) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
  }
  return { windowBus, sent };
}

describe("broadcast music presentation transport", () => {
  it("returns exact transport failure reasons without claiming publication", () => {
    const local = hub();
    const channelFailure = createBroadcastPresentationTransport({
      ...local.windowBus(),
      send: () => ({ crossWindow: false, remoteRelay: "sent" }),
    });
    expect(channelFailure.publish(packet())).toBe("broadcast_channel_failed");
    channelFailure.dispose();

    const relayFailure = createBroadcastPresentationTransport({
      ...local.windowBus(),
      send: () => ({ crossWindow: true, remoteRelay: "failed" }),
    });
    expect(relayFailure.publish(packet())).toBe("ipc_relay_failed");
    relayFailure.dispose();

    const noRelay = createBroadcastPresentationTransport({
      ...local.windowBus(),
      send: () => ({ crossWindow: true, remoteRelay: "unavailable" }),
    });
    expect(noRelay.publish(packet())).toBe("ipc_relay_unavailable");
    noRelay.dispose();
  });
  it("recovers a validated current snapshot when a window joins after earlier publications", () => {
    const bus = hub();
    let current = packet("song-a", 1);
    const producer = createBroadcastPresentationTransport(bus.windowBus(), { currentSnapshot: () => current });
    producer.publish(current);
    current = packet("song-a", 2, "Current verse");
    producer.publish(current);

    const consumer = createBroadcastPresentationTransport(bus.windowBus());
    const received = vi.fn();
    consumer.subscribe(received);
    expect(received).not.toHaveBeenCalled();
    consumer.requestSnapshot();
    expect(bus.sent.at(-2)?.type).toBe(BROADCAST_TYPE.REQUEST_MUSIC_PRESENTATION_SNAPSHOT);
    expect(bus.sent.at(-1)?.type).toBe(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT);
    expect(received).toHaveBeenCalledExactlyOnceWith(current);
    consumer.subscribe(received);
    expect(received).toHaveBeenCalledTimes(2);
    producer.dispose();
    consumer.dispose();
  });

  it("rejects duplicates, stale revisions and an already seen previous session", () => {
    const bus = hub();
    const consumer = createBroadcastPresentationTransport(bus.windowBus());
    const received = vi.fn();
    consumer.subscribe(received);
    const sender = bus.windowBus();
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("before-reload", 20, "A"));
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("before-reload", 20, "Duplicate"));
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("before-reload", 19, "Old"));
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("after-reload", 1, "B"));
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("before-reload", 21, "Late A"));
    expect(received.mock.calls.map(([value]) => value.snapshot.slide?.lyric)).toEqual(["A", "B"]);
    consumer.dispose();
  });

  it("accepts a refreshed envelope for the same core selection, but rejects an older envelope", () => {
    const bus = hub();
    const consumer = createBroadcastPresentationTransport(bus.windowBus());
    const received = vi.fn();
    consumer.subscribe(received);
    const sender = bus.windowBus();
    const first = packet("same-core", 4);
    const refreshed = readMusicPresentationPacket({ ...first, selectionRevision: 5, slideProgress: 60 });
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, first);
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, refreshed);
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, first);
    expect(received).toHaveBeenCalledTimes(2);
    expect(received.mock.calls.at(-1)?.[0]).toMatchObject({ selectionRevision: 5, slideProgress: 60 });
    consumer.dispose();
  });

  it("accepts closed state once, then blocks a late packet from that session", () => {
    const bus = hub();
    const consumer = createBroadcastPresentationTransport(bus.windowBus());
    const received = vi.fn();
    consumer.subscribe(received);
    const sender = bus.windowBus();
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("closed", 1));
    const closed = readMusicPresentationPacket({
      schema: 1, selectionRevision: 2, progress: 0, slideProgress: 0, emittedAt: 1_000,
      snapshot: { sessionId: "closed", revision: 2, active: false, title: "",
        slideIndex: 0, totalSlides: 0, slide: null, nextSlide: null },
    });
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, closed);
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("closed", 3, "Revived"));
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("new", 1, "Fresh"));
    expect(received.mock.calls.map(([value]) => value.snapshot.active)).toEqual([true, false, true]);
    expect(received.mock.calls.at(-1)?.[0].snapshot.slide?.lyric).toBe("Fresh");
    consumer.dispose();
  });

  it("does not publish malformed packets or answer requests without an authority", () => {
    const bus = hub();
    const sender = bus.windowBus();
    const consumer = createBroadcastPresentationTransport(bus.windowBus());
    const received = vi.fn();
    consumer.subscribe(received);
    consumer.publish({ ...packet(), snapshot: { ...packet().snapshot, slide: { lyric: "x", font_size_pct: Infinity } } });
    sender.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, { ...packet(), snapshot: { ...packet().snapshot, slide: { lyric: [] } } });
    consumer.requestSnapshot();
    expect(received).not.toHaveBeenCalled();
    expect(bus.sent.filter((message) => message.type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toHaveLength(1);
    consumer.dispose();
  });
});
