import { describe, expect, it } from "vitest";
import {
  AnnouncementsPresentationAuthority,
  AnnouncementsPresentationGate,
  announcementPosition,
  readAnnouncementPacket,
} from "@/presentation/AnnouncementsPresentationState";

const slides = [
  { id: "one", nome: "One", ordem: 1, texto: "One" },
  { id: "two", nome: "Two", ordem: 2, texto: "Two" },
];
const intent = (session: string, epoch: number) => ({
  announcement_session: session, announcement_epoch: epoch, slides, index: 0,
});

describe("AnnouncementsPresentationState", () => {
  it("rejects an older selection that finishes after a newer one", () => {
    const authority = new AnnouncementsPresentationAuthority();
    const newer = authority.publish(intent("new", 2));
    expect(newer?.announcement_session).toBe("new");
    expect(authority.publish(intent("old", 1))).toBeNull();
    expect(authority.current()).toBe(newer);
  });

  it("versions navigation, rejects old controls, and keeps close as a tombstone", () => {
    const authority = new AnnouncementsPresentationAuthority();
    const first = authority.publish(intent("old", 1));
    const second = authority.publish(intent("new", 2));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(authority.control({ action: "next", announcement_session: "old" })).toBeNull();
    const advanced = authority.control({ action: "next", announcement_session: "new" });
    expect(advanced).toMatchObject({ index: 1, announcement_revision: 2, active: true });
    const gate = new AnnouncementsPresentationGate();
    expect(gate.accept(second)).toEqual(second);
    expect(gate.acceptPosition(announcementPosition(advanced!))).toMatchObject({ index: 1, announcement_revision: 2 });
    expect(gate.acceptPosition(announcementPosition(advanced!))).toBeNull();
    const closed = authority.control({ action: "stop", announcement_session: "new" });
    expect(closed).toMatchObject({ index: 1, announcement_revision: 3, active: false });
    expect(authority.control({ action: "prev", announcement_session: "new" })).toBeNull();
  });

  it("rejects malformed or stale packets and preserves same-revision snapshots", () => {
    const authority = new AnnouncementsPresentationAuthority();
    const first = authority.publish(intent("old", 1))!;
    const second = authority.publish(intent("new", 2))!;
    const gate = new AnnouncementsPresentationGate();
    expect(gate.accept(second)).toEqual(second);
    expect(gate.accept(first)).toBeNull();
    expect(gate.accept({ ...second, slides: [{ id: "x", ordem: "bad" }] })).toBeNull();
    expect(gate.accept({ ...second, index: 1 })).toEqual(second);
    expect(readAnnouncementPacket({ ...second, announcement_revision: -1 })).toBeNull();
  });
});
