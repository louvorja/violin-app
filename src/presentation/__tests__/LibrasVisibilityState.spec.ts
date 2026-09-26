import { describe, expect, it } from "vitest";
import { LibrasVisibilityGate } from "@/presentation/LibrasVisibilityState";

const state = (epoch: number, enabled: boolean) => ({
  libras_epoch: epoch, enabled, musics: true, bible: true, obs: false,
});

describe("LibrasVisibilityGate", () => {
  it("rejects stale and partial toggle snapshots", () => {
    const gate = new LibrasVisibilityGate();
    expect(gate.accept(state(10, true))?.enabled).toBe(true);
    expect(gate.accept(state(9, false))).toBeNull();
    expect(gate.accept(state(10, false))).toBeNull();
    expect(gate.accept({ ...state(11, false), bible: undefined })).toBeNull();
    expect(gate.accept(state(12, false))?.enabled).toBe(false);
  });
});
