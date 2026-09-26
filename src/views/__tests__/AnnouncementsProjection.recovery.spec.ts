import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import {
  AnnouncementsPresentationAuthority,
  announcementPosition,
  beginAnnouncementIntent,
} from "@/presentation/AnnouncementsPresentationState";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(message: { type: string; payload: unknown }) => void>(),
}));
vi.mock("@/composables/useProjectionCloseNotice", () => ({ useProjectionCloseNotice: vi.fn() }));
vi.mock("@/helpers/Broadcast", () => ({
  default: {
    listen: (callback: (message: { type: string; payload: unknown }) => void) => {
      mocks.listeners.add(callback);
      return () => mocks.listeners.delete(callback);
    },
    send: (type: string, payload: unknown) => {
      for (const listener of mocks.listeners) listener({ type, payload });
    },
  },
}));

import Broadcast from "@/helpers/Broadcast";
import AnnouncementsProjection from "@/views/AnnouncementsProjection.vue";

describe("AnnouncementsProjection recovery", () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    mocks.listeners.clear();
  });

  it("requests the current slide after reopen and ignores an old deck", async () => {
    const authority = new AnnouncementsPresentationAuthority();
    const producer = (message: { type: string; payload: unknown }) => {
      if (message.type === BROADCAST_TYPE.ANNOUNCEMENTS_INTENT) {
        const packet = authority.publish(message.payload);
        if (packet) Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, packet);
      } else if (message.type === BROADCAST_TYPE.ANNOUNCEMENTS_CONTROL) {
        const packet = authority.control(message.payload);
        if (packet) Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_POSITION, announcementPosition(packet));
      } else if (message.type === BROADCAST_TYPE.REQUEST_ANNOUNCEMENTS_STATE) {
        const packet = authority.current();
        if (packet) Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, packet);
      }
    };
    mocks.listeners.add(producer);
    const oldToken = beginAnnouncementIntent();
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_INTENT, {
      ...oldToken, slides: [{ id: "old", nome: "Old", ordem: 1, texto: "Old deck" }], index: 0,
    });
    const oldPacket = authority.current();

    const currentToken = beginAnnouncementIntent();
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_INTENT, {
      ...currentToken,
      slides: [
        { id: "first", nome: "First", ordem: 1, texto: "First slide" },
        { id: "second", nome: "Second", ordem: 2, texto: "Second slide" },
      ],
      index: 0,
    });
    wrapper = mount(AnnouncementsProjection, { attachTo: document.body });
    await nextTick();
    expect(wrapper.text()).toContain("First slide");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await nextTick();
    expect(wrapper.text()).toContain("Second slide");

    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, oldPacket);
    await nextTick();
    expect(wrapper.text()).toContain("Second slide");

    wrapper.unmount();
    wrapper = mount(AnnouncementsProjection, { attachTo: document.body });
    await nextTick();
    expect(wrapper.text()).toContain("Second slide");
  });

  it("rejects malformed state and controls from an older session", async () => {
    const authority = new AnnouncementsPresentationAuthority();
    const first = authority.publish({
      ...beginAnnouncementIntent(),
      slides: [{ id: "a", nome: "A", ordem: 1, texto: "Current" }], index: 0,
    });
    expect(first).not.toBeNull();
    wrapper = mount(AnnouncementsProjection, { attachTo: document.body });
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, first);
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, {
      ...first, announcement_revision: 2, slides: [{ id: "invalid", ordem: "bad" }],
    });
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_CONTROL, {
      action: "stop", announcement_session: "retired",
    });
    await nextTick();
    expect(wrapper.text()).toContain("Current");
  });
});
