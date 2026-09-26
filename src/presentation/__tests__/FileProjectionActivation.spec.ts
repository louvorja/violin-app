import { describe, expect, it } from "vitest";
import { FileProjectionActivationGate, readFileActivation } from "@/presentation/FileProjectionActivation";

const packet = (epoch: number, playbackId?: string, url = "https://example.test/file.pdf") => ({
  stage_epoch: epoch, type: "pdf", url, title: "File", playback_id: playbackId,
});

describe("FileProjectionActivationGate", () => {
  it("rejects an old file activation after a new playback", () => {
    const gate = new FileProjectionActivationGate();
    expect(gate.accept(packet(10, "a"))?.playback_id).toBe("a");
    expect(gate.accept(packet(10, "a"))).toBeNull();
    expect(gate.accept(packet(11, "b"))?.playback_id).toBe("b");
    expect(gate.accept(packet(10, "a"))).toBeNull();
    expect(gate.accept(packet(11, "other"))).toBeNull();
  });

  it("allows identity upgrade once while keeping the same selection", () => {
    const gate = new FileProjectionActivationGate();
    expect(gate.accept(packet(10))?.playback_id).toBeUndefined();
    expect(gate.accept(packet(10, "new"))?.playback_id).toBe("new");
    expect(gate.accept(packet(10))).toBeNull();
  });

  it("does not revive the same activation after close", () => {
    const gate = new FileProjectionActivationGate();
    gate.accept(packet(10, "a"));
    gate.retire();
    expect(gate.accept(packet(10, "a"))).toBeNull();
    expect(gate.accept(packet(11, "b"))?.playback_id).toBe("b");
  });

  it("validates boundary fields before handing them to a projection", () => {
    expect(readFileActivation(packet(1, "a"))).not.toBeNull();
    expect(readFileActivation(packet(1, "a", ""))).toBeNull();
    expect(readFileActivation({ ...packet(1, "a"), page: -1 })).toBeNull();
    expect(readFileActivation({ ...packet(1, "a"), libRef: { id: 17 } })).toBeNull();
    expect(readFileActivation({ ...packet(1, "a"), stage_epoch: Infinity })).toBeNull();
  });
});
