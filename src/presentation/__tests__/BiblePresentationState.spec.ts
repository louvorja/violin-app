import { describe, expect, it } from "vitest";
import {
  BiblePresentationAuthority,
  BiblePresentationGate,
  readBiblePresentationPacket,
} from "@/presentation/BiblePresentationState";

const verse = (text: string) => ({ text, reference: "João 3:16", active: true, verses: [16] });

describe("Bible presentation state", () => {
  it("rejects malformed intents and packets at the boundary", () => {
    const authority = new BiblePresentationAuthority(100, "primary");
    expect(authority.publish({ ...verse("x"), verses: [0] })).toBeNull();
    expect(authority.publish({ ...verse("x"), text: { html: "<b>x</b>" } })).toBeNull();
    expect(authority.publish({ ...verse("x"), book_id: -1 })).toBeNull();
    expect(readBiblePresentationPacket({ ...verse("x"), bible_revision: 1 })).toBeNull();
    expect(authority.publish(verse("Valid"))?.bible_revision).toBe(1);
    expect(authority.publish({ ...verse("String chapter"), chapter: "3", verses: ["16"] }))
      .toMatchObject({ chapter: 3, verses: [16], bible_revision: 2 });
  });

  it("accepts exact snapshot re-publication and ignores older or conflicting replies", () => {
    const authority = new BiblePresentationAuthority(100, "primary");
    const gate = new BiblePresentationGate();
    const first = authority.publish(verse("First"))!;
    const current = authority.publish(verse("Current"))!;
    expect(gate.accept(first)?.text).toBe("First");
    expect(gate.accept(current)?.text).toBe("Current");
    expect(gate.accept(first)).toBeNull();
    expect(gate.accept({ ...current, text: "Conflicting" })).toBeNull();
    expect(gate.accept(current)?.text).toBe("Current");
  });

  it("keeps a close ahead of delayed verse and retires a previous shell session", () => {
    const oldShell = new BiblePresentationAuthority(100, "old");
    const newShell = new BiblePresentationAuthority(200, "new");
    const gate = new BiblePresentationGate();
    const opening = oldShell.publish(verse("Opening"))!;
    const closed = oldShell.publish({ active: false, text: "", reference: "" })!;
    expect(gate.accept(opening)?.text).toBe("Opening");
    expect(gate.accept(closed)?.active).toBe(false);
    expect(gate.accept(opening)).toBeNull();
    expect(gate.accept(newShell.publish(verse("After reload")))?.text).toBe("After reload");
    expect(gate.accept(oldShell.publish(verse("Late old shell")))).toBeNull();
  });
});
