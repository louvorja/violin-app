import { describe, expect, it } from "vitest";
import { VideoStateGate, VideoStateRevisionCounter } from "@/helpers/VideoStateVersion";
import type { VideoMediaState } from "@/types/Media";

const state = (patch: Partial<VideoMediaState> = {}): VideoMediaState => ({
  currentTime: 10,
  isPaused: false,
  duration: 100,
  ...patch,
});

describe("VideoStateRevisionCounter", () => {
  it("gera revisão monotônica por playback e reinicia para um playback novo", () => {
    const counter = new VideoStateRevisionCounter();

    expect(counter.next("playback-a")).toEqual({ playback_id: "playback-a", revision: 1 });
    expect(counter.next("playback-a")).toEqual({ playback_id: "playback-a", revision: 2 });
    expect(counter.next("playback-b")).toEqual({ playback_id: "playback-b", revision: 1 });
  });
});

describe("VideoStateGate", () => {
  it("mantém compatibilidade legada somente até o primeiro payload versionado", () => {
    const gate = new VideoStateGate();
    gate.begin();

    expect(gate.accepts(null)).toBe(false);
    expect(gate.accepts(undefined)).toBe(false);
    expect(gate.accepts(state())).toBe(true);
    expect(gate.accepts(state({ playback_id: "playback-a", revision: 1 }))).toBe(true);
    expect(gate.accepts(state())).toBe(false);
    expect(gate.accepts(state({ playback_id: "playback-a" }))).toBe(false);
    expect(gate.accepts(state({ revision: 2 }))).toBe(false);
  });

  it("rejeita payload legado assim que a projeção conhece o playback esperado", () => {
    const gate = new VideoStateGate();
    gate.begin("playback-a");

    expect(gate.accepts(state())).toBe(false);
    expect(gate.accepts(state({ playback_id: "playback-a", revision: 1 }))).toBe(true);
  });

  it("rejeita estado atrasado de outro playback", () => {
    const gate = new VideoStateGate();
    gate.begin("playback-new");

    expect(gate.accepts(state({ playback_id: "playback-old", revision: 99 }))).toBe(false);
    expect(gate.accepts(state({ playback_id: "playback-new", revision: 1 }))).toBe(true);
  });

  it("rejeita revisão duplicada ou fora de ordem", () => {
    const gate = new VideoStateGate();
    gate.begin("playback-a");

    expect(gate.accepts(state({ playback_id: "playback-a", revision: 3 }))).toBe(true);
    expect(gate.accepts(state({ playback_id: "playback-a", revision: 3 }))).toBe(false);
    expect(gate.accepts(state({ playback_id: "playback-a", revision: 2 }))).toBe(false);
    expect(gate.accepts(state({ playback_id: "playback-a", revision: 4 }))).toBe(true);
  });

  it("troca rapidamente de playback sem deixar o anterior reassumir", () => {
    const gate = new VideoStateGate();
    gate.begin("playback-a");
    expect(gate.accepts(state({ playback_id: "playback-a", revision: 8 }))).toBe(true);

    gate.begin("playback-b");

    expect(gate.accepts(state({ playback_id: "playback-a", revision: 9 }))).toBe(false);
    expect(gate.accepts(state({ playback_id: "playback-b", revision: 1 }))).toBe(true);
    expect(gate.accepts(state({ playback_id: "playback-a", revision: 10 }))).toBe(false);
  });
});
