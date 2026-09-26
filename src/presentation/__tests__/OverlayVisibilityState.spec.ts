import { describe, expect, it } from "vitest";
import { OverlayVisibilityGate } from "@/presentation/OverlayVisibilityState";

describe("OverlayVisibilityGate", () => {
  it("accepts only ordered global visibility snapshots", () => {
    const gate = new OverlayVisibilityGate();
    expect(gate.accept({ enabled: true, overlay_epoch: 10 })?.enabled).toBe(true);
    expect(gate.accept({ enabled: false, overlay_epoch: 9 })).toBeNull();
    expect(gate.accept({ enabled: false, overlay_epoch: 10 })).toBeNull();
    expect(gate.accept({ enabled: false, slot: { id: "a" } })).toBeNull();
    expect(gate.accept({ enabled: false, overlay_epoch: 11 })?.enabled).toBe(false);
    expect(gate.accept({ enabled: true, overlay_epoch: Infinity })).toBeNull();
  });
});
