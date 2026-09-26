import { describe, expect, it } from "vitest";
import {
  ModulePresentationAuthority,
  ModulePresentationGate,
  readModulePresentationPacket,
} from "@/presentation/ModulePresentationState";

describe("module presentation state", () => {
  it("validates module identity and payload boundaries", () => {
    const authority = new ModulePresentationAuthority(100, "shell");
    expect(authority.publish({ module: "../timer", text: "1" })).toBeNull();
    expect(authority.publish({ module: "timer", reference: [4] })).toBeNull();
    expect(readModulePresentationPacket({ module: "timer", text: "1" })).toBeNull();
    expect(authority.publish({ module: "timer", text: "00:30", color: "red" }))
      .toMatchObject({ module_revision: 1, text: "00:30", color: "red" });
  });

  it("orders each module independently and ignores delayed request replies", () => {
    const authority = new ModulePresentationAuthority(100, "shell");
    const gate = new ModulePresentationGate();
    const timer1 = authority.publish({ module: "timer", text: "00:30", active: true })!;
    const draw1 = authority.publish({ module: "draw", text: "7", reference: ["3", "7"] })!;
    const timer2 = authority.publish({ module: "timer", text: "00:29", active: true })!;
    expect(gate.accept(timer1)?.text).toBe("00:30");
    expect(gate.accept(draw1)?.reference).toEqual(["3", "7"]);
    expect(gate.accept(timer2)?.text).toBe("00:29");
    expect(gate.accept(timer1)).toBeNull();
    expect(gate.accept({ ...timer2, text: "old same revision" })).toBeNull();
    expect(gate.accept(timer2)?.text).toBe("00:29");
  });

  it("keeps close ahead of an old value and rejects retired shell sessions", () => {
    const oldShell = new ModulePresentationAuthority(100, "old");
    const newShell = new ModulePresentationAuthority(200, "new");
    const gate = new ModulePresentationGate();
    const active = oldShell.publish({ module: "counter", text: "5", active: true })!;
    const closed = oldShell.publish({ module: "counter", active: false })!;
    expect(gate.accept(active)?.active).toBe(true);
    expect(gate.accept(closed)?.active).toBe(false);
    expect(gate.accept(active)).toBeNull();
    expect(gate.accept(newShell.publish({ module: "counter", text: "1", active: true }))?.text)
      .toBe("1");
    expect(gate.accept(oldShell.publish({ module: "counter", text: "6", active: true })))
      .toBeNull();
  });
});
