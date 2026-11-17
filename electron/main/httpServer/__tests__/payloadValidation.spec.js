// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isMediaState, isStopwatchState } = require("../payloadValidation");

const media = {
  active: true,
  playing: false,
  loading: false,
  minimized: false,
  source: "file",
  title: "Culto",
  subtitle: "Canal do culto",
  fileName: "video.mp4",
  position: 12.5,
  duration: 120,
  canPlay: true,
  canPause: false,
  canSeek: true,
  canPrevious: false,
  canNext: true,
  seq: 1,
};

const stopwatch = {
  running: false,
  mode: "countdown",
  elapsed: 10,
  target: 600,
  remaining: 590,
  alert: "",
  overtime: true,
  showSeconds: true,
  warningSeconds: 60,
  laps: [{ index: 1, elapsed: 10, shown: 590 }],
  projecting: false,
  seq: 1,
};

describe("payloadValidation — Player", () => {
  it("aceita o snapshot completo, incluindo subtitle", () => {
    expect(isMediaState({ ...media })).toBe(true);
  });

  it("recusa subtitle ausente/inválido e campos fora do contrato", () => {
    const { subtitle: _subtitle, ...semSubtitle } = media;
    expect(isMediaState(semSubtitle)).toBe(false);
    expect(isMediaState({ ...media, subtitle: 1 })).toBe(false);
    expect(isMediaState({ ...media, subtitle: "x".repeat(4_097) })).toBe(false);
    expect(isMediaState({ ...media, source: "embed" })).toBe(false);
    expect(isMediaState({ ...media, position: -1 })).toBe(false);
    expect(isMediaState({ ...media, seq: 1.5 })).toBe(false);
  });
});

describe("payloadValidation — Cronômetro", () => {
  it("aceita snapshot e voltas válidas", () => {
    expect(isStopwatchState({ ...stopwatch })).toBe(true);
  });

  it("recusa voltas inválidas e campos fora do contrato", () => {
    expect(
      isStopwatchState({ ...stopwatch, laps: [{ index: 0, elapsed: 1, shown: 1 }] })
    ).toBe(false);
    expect(
      isStopwatchState({ ...stopwatch, laps: [{ index: 1, elapsed: -1, shown: 1 }] })
    ).toBe(false);
    expect(isStopwatchState({ ...stopwatch, projecting: "não" })).toBe(false);
    expect(isStopwatchState({ ...stopwatch, target: -1 })).toBe(false);
  });
});
