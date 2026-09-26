import { describe, expect, it } from "vitest";
import {
  BackgroundPresentationGate,
  readBackgroundState,
  readStoredBackgroundState,
} from "@/presentation/BackgroundPresentationState";

const image = (epoch: number, url = "https://example.test/a.png") => ({
  active: true, epoch, type: "image", url, title: "Fundo",
});

describe("BackgroundPresentationGate", () => {
  it("keeps the newest selection across delayed play, duplicate and clear packets", () => {
    const gate = new BackgroundPresentationGate();
    expect(gate.accept(image(10))?.url).toBe(image(10).url);
    expect(gate.accept(image(11, "https://example.test/b.png"))?.epoch).toBe(11);
    expect(gate.accept(image(10))).toBeNull();
    expect(gate.accept(image(11, "https://example.test/b.png"))).toBeNull();
    expect(gate.accept({ active: false, epoch: 12 })?.active).toBe(false);
    expect(gate.accept(image(11, "https://example.test/b.png"))).toBeNull();
    expect(gate.accept(image(13))?.active).toBe(true);
  });

  it("validates broadcasts and preserves the prior beta's stored selection", () => {
    expect(readBackgroundState({ ...image(1), epoch: Infinity })).toBeNull();
    expect(readBackgroundState({ ...image(1), url: "" })).toBeNull();
    expect(readBackgroundState({ ...image(1), type: "pdf" })).toBeNull();
    expect(readStoredBackgroundState({ type: "image", url: "https://example.test/a.png" }))
      .toMatchObject({ active: true, epoch: 1, type: "image" });
    expect(readStoredBackgroundState({ type: "image", url: "" })).toBeNull();
  });
});
