import { describe, expect, it } from "vitest";
import { createOverlaySlot } from "@/types/Overlay";
import { mergeEnabledState } from "../slotMerge";

describe("mergeEnabledState", () => {
  it("preserva o enabled gravado por fora quando o módulo não tocou no slot", () => {
    const local = createOverlaySlot({ id: "s1", enabled: true });
    local.name = "Editado no módulo";
    const stored = createOverlaySlot({ id: "s1", enabled: false });

    const [merged] = mergeEnabledState([local], [stored], new Set());

    expect(merged.enabled).toBe(false);
    expect(merged.name).toBe("Editado no módulo");
  });

  it("mantém o enabled do módulo quando o interruptor foi usado aqui", () => {
    const local = createOverlaySlot({ id: "s1", enabled: true });
    const stored = createOverlaySlot({ id: "s1", enabled: false });

    const [merged] = mergeEnabledState([local], [stored], new Set(["s1"]));

    expect(merged.enabled).toBe(true);
  });

  it("não perde um slot novo que ainda não está no disco", () => {
    const local = createOverlaySlot({ id: "novo", enabled: true });

    const [merged] = mergeEnabledState([local], [], new Set());

    expect(merged.enabled).toBe(true);
    expect(merged.id).toBe("novo");
  });
});
