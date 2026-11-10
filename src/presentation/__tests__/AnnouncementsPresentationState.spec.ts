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

  const packetWithFit = (mediaFit: unknown) => ({
    ...intent("fit", 1),
    announcement_schema: 1,
    announcement_revision: 1,
    active: true,
    slides: [{ id: "m", nome: "M", ordem: 1, style: { mediaFit } }],
  });

  it("accepts every known mediaFit and slides without it", () => {
    for (const fit of ["cover", "contain", "fill", "none"]) {
      expect(readAnnouncementPacket(packetWithFit(fit))?.slides[0].style?.mediaFit).toBe(fit);
    }
    const plain = {
      ...intent("fit", 2),
      announcement_schema: 1,
      announcement_revision: 1,
      active: true,
      slides: [{ id: "m", nome: "M", ordem: 1 }],
    };
    expect(readAnnouncementPacket(plain)).not.toBeNull();
  });

  it("rejects unknown mediaFit values and wrong types at the boundary", () => {
    expect(readAnnouncementPacket(packetWithFit("crop"))).toBeNull();
    expect(readAnnouncementPacket(packetWithFit(123))).toBeNull();
    expect(readAnnouncementPacket(packetWithFit(["cover"]))).toBeNull();
  });

  it("carries media as Blob, still accepts legacy ArrayBuffer and rejects anything else", () => {
    const withMedia = (videoData: unknown) => ({
      ...intent("media", 3),
      announcement_schema: 1,
      announcement_revision: 1,
      active: true,
      slides: [{ id: "v", nome: "V", ordem: 1, videoData, videoMime: "video/mp4" }],
    });
    const video = new Blob(["x"], { type: "video/mp4" });
    expect(readAnnouncementPacket(withMedia(video))?.slides[0].videoData).toBe(video);
    expect(readAnnouncementPacket(withMedia(new ArrayBuffer(4)))).not.toBeNull();
    expect(readAnnouncementPacket(withMedia("data:video/mp4;base64,AA"))).toBeNull();
  });
});
