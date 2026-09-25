// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
const events = require("../events.js");

function openClient(writeResults = []) {
  const req = new EventEmitter();
  const res = new EventEmitter();
  const writes = [];
  const results = [...writeResults];

  res.writeHead = vi.fn();
  res.write = vi.fn((data) => {
    writes.push(data);
    return results.length > 0 ? results.shift() : true;
  });
  res.end = vi.fn();

  events.handler(req, res);
  return { req, res, writes };
}

function messages(writes) {
  return writes
    .filter((data) => data.startsWith("data: "))
    .map((data) => JSON.parse(data.slice("data: ".length)));
}

afterEach(() => {
  events.closeAll();
  vi.useRealTimers();
});

describe("HTTP SSE — backpressure", () => {
  const canonicalSnapshot = (revision, lyric) => ({
    schema: 1,
    selectionRevision: revision,
    progress: 0,
    slideProgress: 0,
    emittedAt: 1_800_000_000_000,
    snapshot: {
      sessionId: "session-a",
      revision,
      active: true,
      title: "Louvor",
      slideIndex: 0,
      totalSlides: 1,
      slide: { lyric },
      nextSlide: null,
    },
  });

  it("replays the latest canonical music snapshot to a late SSE client and purges it on close", () => {
    events.publish({ type: "slide_change", payload: { title: "Old editor slide", slide: { lyric: "Old" } } });
    events.publish({ type: "music_presentation_snapshot", payload: canonicalSnapshot(3, "Atual") });
    events.publish({ type: "slides_data", payload: { title: "Current song", slides: ["metadata"] } });
    const lateClient = openClient();
    expect(messages(lateClient.writes)).toEqual([
      {
      type: "music_presentation_snapshot",
      payload: canonicalSnapshot(3, "Atual"),
      },
      { type: "slides_data", payload: { title: "Current song", slides: ["metadata"] } },
    ]);

    events.publish({ type: "slide_change", payload: { title: "New editor slide", slide: { lyric: "New" } } });
    const afterEditorSlide = openClient();
    expect(messages(afterEditorSlide.writes)).toEqual([
      { type: "slide_change", payload: { title: "New editor slide", slide: { lyric: "New" } } },
    ]);

    events.publish({ type: "media_close", payload: {} });
    const afterClose = openClient();
    expect(messages(afterClose.writes)).not.toContainEqual(
      expect.objectContaining({ type: "music_presentation_snapshot" })
    );
  });

  it("relays a canonical closed snapshot without requiring a separate MEDIA_CLOSE", () => {
    const active = canonicalSnapshot(1, "Verse");
    const closed = {
      ...active,
      snapshot: {
        ...active.snapshot, revision: 2, active: false, title: "",
        slideIndex: 0, totalSlides: 0, slide: null, nextSlide: null,
      },
    };
    events.publish({ type: "music_presentation_snapshot", payload: active });
    events.publish({ type: "music_presentation_snapshot", payload: closed });
    const lateClient = openClient();
    expect(messages(lateClient.writes)).toEqual([
      { type: "music_presentation_snapshot", payload: closed },
    ]);
  });

  it("serves the cached canonical snapshot over a real local HTTP SSE connection", async () => {
    const packet = canonicalSnapshot(7, "HTTP SSE");
    events.publish({ type: "music_presentation_snapshot", payload: packet });
    const server = createServer(events.handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP address");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/events`, {
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = "";
      while (!received.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += decoder.decode(chunk.value, { stream: true });
        if (received.startsWith(":ok\n\n")) received = received.slice(5);
      }
      expect(received).toContain(`data: ${JSON.stringify({ type: "music_presentation_snapshot", payload: packet })}\n\n`);
      await reader.cancel();
    } finally {
      clearTimeout(timeout);
      controller.abort();
      events.closeAll();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("coalesces canonical snapshots under backpressure and keeps MEDIA_CLOSE as a queue barrier", () => {
    const client = openClient([true, false]);
    events.publish({ type: "music_presentation_snapshot", payload: canonicalSnapshot(1, "Antes") });
    events.publish({ type: "music_presentation_snapshot", payload: canonicalSnapshot(2, "Obsoleto") });
    events.publish({ type: "media_close", payload: {} });
    events.publish({ type: "music_presentation_snapshot", payload: canonicalSnapshot(3, "Depois") });

    expect(events.status()).toMatchObject({ blocked: 1, queued: 2 });
    client.res.emit("drain");

    const delivered = messages(client.writes);
    expect(delivered).toEqual([
      { type: "music_presentation_snapshot", payload: canonicalSnapshot(1, "Antes") },
      { type: "media_close", payload: {} },
      { type: "music_presentation_snapshot", payload: canonicalSnapshot(3, "Depois") },
    ]);
    expect(delivered).not.toContainEqual(
      expect.objectContaining({
        type: "music_presentation_snapshot",
        payload: canonicalSnapshot(2, "Obsoleto"),
      })
    );
    expect(events.status()).toMatchObject({ blocked: 0, queued: 0 });
  });

  it("new editor slide evicts queued music state while already-written data is cleared by receivers", () => {
    const client = openClient([true, false]);
    const songMetadata = { title: "Current song", slides: ["metadata"] };
    events.publish({ type: "slides_data", payload: songMetadata });
    events.publish({ type: "slide_change", payload: { title: "Old editor slide" } });
    events.publish({ type: "music_presentation_snapshot", payload: canonicalSnapshot(5, "Canonical") });
    events.publish({ type: "slide_change", payload: { title: "New editor slide" } });

    expect(events.status()).toMatchObject({ blocked: 1, queued: 1 });
    client.res.emit("drain");
    expect(messages(client.writes)).toEqual([
      { type: "slides_data", payload: songMetadata },
      { type: "slide_change", payload: { title: "New editor slide" } },
    ]);
  });

  it("does not let a malformed canonical snapshot evict the cached legacy slide", () => {
    const oldEditorSlide = { title: "Old editor slide" };
    events.publish({ type: "slide_change", payload: oldEditorSlide });
    const malformed = canonicalSnapshot(2, "unused");
    malformed.snapshot.slide.lyric = [];
    events.publish({ type: "music_presentation_snapshot", payload: malformed });

    const lateClient = openClient();
    expect(messages(lateClient.writes)).toEqual([
      { type: "slide_change", payload: oldEditorSlide },
    ]);
  });

  it.each(["module_projection_value", "module_format_changed"])("preserva estados independentes por modulo em %s e no replay", (type) => {
    const client = openClient([true, false]);
    events.publish({ type: "slide_change", payload: { index: 0 } });
    events.publish({ type, payload: { module: "countdown", value: 42 } });
    events.publish({ type, payload: { module: "clock", value: "12:00" } });
    events.publish({ type, payload: { module: "countdown", value: 41 } });

    expect(events.status().queued).toBe(2);
    client.res.emit("drain");
    const expected = [
      { type, payload: { module: "clock", value: "12:00" } },
      { type, payload: { module: "countdown", value: 41 } },
    ];
    expect(messages(client.writes).filter((msg) => msg.type === type)).toEqual(expected);

    const reconnect = openClient();
    expect(messages(reconnect.writes).filter((msg) => msg.type === type)).toEqual(expected);
  });

  it("limita snapshots mesmo com muitas identidades e usa fallback para modulo invalido", () => {
    for (let index = 0; index < 200; index++) {
      events.publish({ type: "module_projection_value", payload: { module: `module_${index}` } });
    }
    events.publish({ type: "module_projection_value", payload: { module: {}, value: 1 } });
    events.publish({ type: "module_projection_value", payload: { value: 2 } });
    const client = openClient();
    expect(messages(client.writes)).toHaveLength(64);
    expect(messages(client.writes).at(-1)).toEqual({ type: "module_projection_value", payload: { value: 2 } });
  });

  it("aguarda drain e mantém somente o estado mais recente de cada tipo", () => {
    // :ok é aceito; o primeiro evento entra no buffer e sinaliza backpressure.
    const client = openClient([true, false]);

    events.publish({ type: "slide_change", payload: { index: 0 } });
    for (let index = 1; index <= 100; index++) {
      events.publish({ type: "slide_change", payload: { index } });
    }

    expect(events.status()).toMatchObject({ clients: 1, blocked: 1, queued: 1 });
    expect(messages(client.writes)).toEqual([
      { type: "slide_change", payload: { index: 0 } },
    ]);

    client.res.emit("drain");

    expect(messages(client.writes)).toEqual([
      { type: "slide_change", payload: { index: 0 } },
      { type: "slide_change", payload: { index: 100 } },
    ]);
    expect(events.status()).toMatchObject({ blocked: 0, queued: 0 });
  });

  it("limita a fila de eventos não coalescíveis para clientes lentos", () => {
    const client = openClient([true, false]);

    events.publish({ type: "chat_message", payload: { index: 0 } });
    for (let index = 1; index <= events.MAX_CLIENT_QUEUE + 20; index++) {
      events.publish({ type: "chat_message", payload: { index } });
    }

    expect(events.status().queued).toBe(events.MAX_CLIENT_QUEUE);

    client.res.emit("drain");
    const delivered = messages(client.writes);

    expect(delivered).toHaveLength(events.MAX_CLIENT_QUEUE + 1);
    expect(delivered.at(-1)).toEqual({
      type: "chat_message",
      payload: { index: events.MAX_CLIENT_QUEUE + 20 },
    });
    expect(events.status().queued).toBe(0);
  });

  it("preserva media_close como barreira terminal e remove slides obsoletos", () => {
    const client = openClient([true, false]);

    events.publish({ type: "slide_change", payload: { index: 1 } });
    events.publish({ type: "slide_change", payload: { index: 2 } });
    for (let index = 0; index < events.MAX_CLIENT_QUEUE + 8; index++) {
      events.publish({ type: "chat_message", payload: { index } });
    }
    events.publish({ type: "media_close", payload: {} });
    events.publish({ type: "slide_change", payload: { index: 3 } });

    expect(events.status().queued).toBeLessThanOrEqual(events.MAX_CLIENT_QUEUE);
    client.res.emit("drain");

    const delivered = messages(client.writes);
    const terminalIndex = delivered.findIndex((msg) => msg.type === "media_close");
    const newSlideIndex = delivered.findIndex(
      (msg) => msg.type === "slide_change" && msg.payload.index === 3
    );

    expect(terminalIndex).toBeGreaterThan(0);
    expect(newSlideIndex).toBeGreaterThan(terminalIndex);
    expect(delivered).not.toContainEqual({ type: "slide_change", payload: { index: 2 } });
  });

  it("limpa keepalive, fila e listeners ao desconectar", () => {
    vi.useFakeTimers();
    const client = openClient([true, false]);
    events.publish({ type: "slide_change", payload: { index: 1 } });
    events.publish({ type: "slide_change", payload: { index: 2 } });

    expect(vi.getTimerCount()).toBe(1);
    expect(events.status()).toMatchObject({ clients: 1, blocked: 1, queued: 1 });

    client.req.emit("close");

    expect(events.status()).toMatchObject({ clients: 0, blocked: 0, queued: 0 });
    expect(client.res.listenerCount("drain")).toBe(0);
    expect(client.req.listenerCount("close")).toBe(0);
    expect(client.res.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
