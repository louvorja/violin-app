import { describe, expect, it, vi } from "vitest";

vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn() } }));
vi.mock("@/helpers/AppData", () => ({ default: { get: () => true } }));

import { divergenceOf } from "../useScreenTruth";

const playing = { video: true, paused: false, time: 10 };
const paused = { video: true, paused: true, time: 10 };

describe("divergenceOf", () => {
  it("tela rodando com o player pausado", () => {
    expect(divergenceOf({ isPaused: false, currentTime: 12 }, paused)).toBe("playing");
  });

  it("tela parada com o player tocando", () => {
    expect(divergenceOf({ isPaused: true, currentTime: 10 }, playing)).toBe("paused");
  });

  it("tempos longe um do outro com os dois tocando", () => {
    expect(divergenceOf({ isPaused: false, currentTime: 13 }, playing)).toBe("drift");
    expect(divergenceOf({ isPaused: false, currentTime: 11.5 }, playing)).toBeNull();
  });

  it("vídeo na tela sem vídeo no player é vídeo sem controle; parado, não incomoda", () => {
    const none = { video: false, paused: true, time: 0 };
    expect(divergenceOf({ isPaused: false, currentTime: 3 }, none)).toBe("orphan");
    expect(divergenceOf({ isPaused: true, currentTime: 3 }, none)).toBeNull();
  });

  it("pausados juntos: tudo certo, mesmo com o tempo diferente", () => {
    expect(divergenceOf({ isPaused: true, currentTime: 4 }, paused)).toBeNull();
  });
});
