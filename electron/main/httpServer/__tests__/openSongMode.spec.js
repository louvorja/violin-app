// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveSongMode } from "../routes.js";

describe("resolveSongMode — prioridade mode > tag > cantado", () => {
  it("usa o `mode` quando válido", () => {
    expect(resolveSongMode({ mode: "instrumental", tag: 3 })).toBe("instrumental");
    expect(resolveSongMode({ mode: "no_audio" })).toBe("no_audio");
    expect(resolveSongMode({ mode: "audio-only" })).toBe("audio-only");
    expect(resolveSongMode({ mode: "playback-only" })).toBe("playback-only");
  });

  it("ignora `mode` inválido e cai no `tag`", () => {
    expect(resolveSongMode({ mode: "bogus", tag: 2 })).toBe("instrumental");
    expect(resolveSongMode({ mode: "", tag: 3 })).toBe("no_audio");
  });

  it("mapeia o `tag` legado quando não há mode", () => {
    expect(resolveSongMode({ tag: 1 })).toBe("audio");
    expect(resolveSongMode({ tag: 2 })).toBe("instrumental");
    expect(resolveSongMode({ tag: 3 })).toBe("no_audio");
  });

  it("sem mode nem tag abre cantado (audio)", () => {
    expect(resolveSongMode({})).toBe("audio");
    expect(resolveSongMode(null)).toBe("audio");
    expect(resolveSongMode({ tag: 99 })).toBe("audio");
  });
});
