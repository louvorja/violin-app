import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const transmission = vi.hoisted(() => ({ broadcast: vi.fn() }));

vi.mock("@/helpers/Platform", () => ({ default: { transmission } }));

describe("Broadcast music presentation relay", () => {
  beforeEach(() => {
    vi.resetModules();
    transmission.broadcast.mockReset();
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        addEventListener() {}
        postMessage() {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("relays and replays canonical snapshots, then clears them on MEDIA_CLOSE", async () => {
    const { default: Broadcast } = await import("../Broadcast");
    const packet = {
      schema: 1,
      selectionRevision: 4,
      progress: 0,
      slideProgress: 0,
      emittedAt: 1_800_000_000_000,
      snapshot: {
        sessionId: "session-a",
        revision: 4,
        active: true,
        title: "Louvor",
        slideIndex: 0,
        totalSlides: 1,
        slide: { lyric: "Aleluia" },
        nextSlide: null,
      },
    };

    Broadcast.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet);
    expect(transmission.broadcast).toHaveBeenCalledWith({
      type: BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT,
      payload: packet,
    });

    const replayed: Array<{ type: string; payload: unknown }> = [];
    const stopFirst = Broadcast.listen((message) => replayed.push(message));
    expect(replayed).toContainEqual({
      type: BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT,
      payload: packet,
    });
    stopFirst();

    Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE);
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toBeNull();

    const afterClose: Array<{ type: string; payload: unknown }> = [];
    const stopSecond = Broadcast.listen((message) => afterClose.push(message));
    expect(afterClose).not.toContainEqual({
      type: BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT,
      payload: packet,
    });
    stopSecond();
  });

  it("reports a failed cross-window enqueue while keeping local delivery", async () => {
    vi.stubGlobal("BroadcastChannel", class {
      addEventListener() {}
      postMessage() { throw new Error("channel unavailable"); }
    });
    const { default: Broadcast } = await import("../Broadcast");
    const received = vi.fn();
    const stop = Broadcast.listen(received, { replay: false });
    const delivery = Broadcast.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, {
      schema: 1, selectionRevision: 1, progress: 0, slideProgress: 0, emittedAt: Date.now(),
      snapshot: { sessionId: "failed-channel", revision: 1, active: true, title: "",
        slideIndex: 0, totalSlides: 1, slide: { lyric: "Verse" }, nextSlide: null },
    });
    expect(delivery).toEqual({ crossWindow: false, remoteRelay: "sent" });
    expect(received).toHaveBeenCalledOnce();
    stop();
  });

  it("keeps local listeners usable if BroadcastChannel cannot be constructed", async () => {
    vi.stubGlobal("BroadcastChannel", class {
      constructor() { throw new Error("unavailable"); }
    });
    const { default: Broadcast } = await import("../Broadcast");
    const received = vi.fn();
    const stop = Broadcast.listen(received, { replay: false });
    expect(Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE)).toEqual({
      crossWindow: false, remoteRelay: "sent",
    });
    expect(received).toHaveBeenCalledOnce();
    stop();
  });

  it("reports a failed SSE IPC enqueue separately from BroadcastChannel", async () => {
    transmission.broadcast.mockImplementation(() => { throw new Error("ipc unavailable"); });
    const { default: Broadcast } = await import("../Broadcast");
    expect(Broadcast.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toEqual({
      crossWindow: true, remoteRelay: "failed",
    });
  });

  it("active canonical music evicts old editor slide replay but preserves song metadata", async () => {
    const { default: Broadcast } = await import("../Broadcast");
    const metadata = { title: "Current song", slides: ["metadata"] };
    const oldEditorSlide = { title: "Old editor slide", slide: { lyric: "Old" } };
    const packet = {
      schema: 1,
      selectionRevision: 4,
      progress: 0,
      slideProgress: 0,
      emittedAt: 1_800_000_000_000,
      snapshot: {
        sessionId: "session-a",
        revision: 4,
        active: true,
        title: "Current song",
        slideIndex: 0,
        totalSlides: 1,
        slide: { lyric: "Canonical slide" },
        nextSlide: null,
      },
    };

    Broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, oldEditorSlide);
    Broadcast.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet);
    Broadcast.send(BROADCAST_TYPE.SLIDES_DATA, metadata);
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.SLIDE_CHANGE)).toBeNull();
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.SLIDES_DATA)).toEqual(metadata);

    const currentEditorSlide = { title: "New editor slide", slide: { lyric: "New" } };
    Broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, currentEditorSlide);
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.SLIDES_DATA)).toBeNull();
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toBeNull();
    const replayed: Array<{ type: string; payload: unknown }> = [];
    const stop = Broadcast.listen((message) => replayed.push(message));
    expect(replayed).toEqual([
      { type: BROADCAST_TYPE.SLIDE_CHANGE, payload: currentEditorSlide },
    ]);
    stop();
  });

  it("a malformed canonical packet leaves the previous cached editor slide alone", async () => {
    const { default: Broadcast } = await import("../Broadcast");
    const editorSlide = { title: "Current editor slide" };
    Broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, editorSlide);
    Broadcast.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, {
      schema: 1,
      selectionRevision: 2,
      progress: 0,
      slideProgress: 0,
      emittedAt: 1_800_000_000_000,
      snapshot: {
        sessionId: "session-a",
        revision: 2,
        active: true,
        title: "Current song",
        slideIndex: 0,
        totalSlides: 1,
        slide: { lyric: [] },
        nextSlide: null,
      },
    });
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.SLIDE_CHANGE)).toEqual(editorSlide);
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toBeNull();
  });

  it("does not cache or replay an old Libras toggle after a newer one", async () => {
    const { default: Broadcast } = await import("../Broadcast");
    const state = (epoch: number, enabled: boolean) => ({
      libras_epoch: epoch, enabled, musics: true, bible: true, obs: false,
    });
    Broadcast.send(BROADCAST_TYPE.LIBRAS_TOGGLE, state(10, true));
    Broadcast.send(BROADCAST_TYPE.LIBRAS_TOGGLE, state(11, false));
    Broadcast.send(BROADCAST_TYPE.LIBRAS_TOGGLE, state(10, true));
    expect(Broadcast.getLastPayload(BROADCAST_TYPE.LIBRAS_TOGGLE)).toEqual(state(11, false));
    const received: unknown[] = [];
    const stop = Broadcast.listen((message) => {
      if (message.type === BROADCAST_TYPE.LIBRAS_TOGGLE) received.push(message.payload);
    });
    expect(received).toEqual([state(11, false)]);
    stop();
  });
});
