import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  listeners: new Set<(message: { type: string; payload: unknown }) => void>(),
}));
vi.mock("@/helpers/IndexedDB", () => ({ default: { get: mocks.get } }));
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
    mocks.get.mockReset();
    mocks.listeners.clear();
  });

  it("keeps a live selection when an older IndexedDB recovery finishes later", async () => {
    let resolveStored!: (value: unknown) => void;
    mocks.get.mockReturnValue(new Promise((resolve) => { resolveStored = resolve; }));
    wrapper = mount(AnnouncementsProjection, { attachTo: document.body });
    await nextTick();
    expect(mocks.get).toHaveBeenCalledOnce();

    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, {
      slides: [{ id: "current", nome: "Current", ordem: 1, texto: "Current announcement" }],
      index: 0,
    });
    await nextTick();
    expect(wrapper.text()).toContain("Current announcement");

    resolveStored({ data: {
      slides: [{ id: "old", nome: "Old", ordem: 1, texto: "Old announcement" }], index: 0,
    } });
    await flushPromises();
    expect(wrapper.text()).toContain("Current announcement");
    expect(wrapper.text()).not.toContain("Old announcement");
  });

  it("ignores malformed live state without blocking persisted recovery", async () => {
    let resolveStored!: (value: unknown) => void;
    mocks.get.mockReturnValue(new Promise((resolve) => { resolveStored = resolve; }));
    wrapper = mount(AnnouncementsProjection, { attachTo: document.body });
    await nextTick();

    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, {
      slides: [{ id: "invalid", nome: "Invalid", ordem: "first" }], index: 0,
    });
    resolveStored({ data: {
      slides: [{ id: "stored", nome: "Stored", ordem: 1, texto: "Stored announcement" }],
      index: 0,
    } });
    await flushPromises();
    expect(wrapper.text()).toContain("Stored announcement");
  });
});
