// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

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
