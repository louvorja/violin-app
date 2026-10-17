import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import {
  AnnouncementsPresentationAuthority,
  beginAnnouncementIntent,
  type AnnouncementSlide,
} from "@/presentation/AnnouncementsPresentationState";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(_message: { type: string; payload: unknown }) => void>(),
}));
vi.mock("@/composables/useProjectionCloseNotice", () => ({ useProjectionCloseNotice: vi.fn() }));
vi.mock("@/components/OverlayRenderer.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/helpers/Broadcast", () => ({
  default: {
    listen: (callback: (_message: { type: string; payload: unknown }) => void) => {
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
import AnnouncementsLayer from "@/modules/announcements/components/ProjectionLayer.vue";
import { useUserDataStore } from "@/stores/userDataStore";

const slides = [
  { id: "a", nome: "A", ordem: 1, texto: "Slide A" },
  { id: "b", nome: "B", ordem: 2, texto: "Slide B" },
];

const KEY_TYPE = "modules.announcements.transition_type";
const KEY_DURATION = "modules.announcements.transition_duration";
const OPT = "modules.announcements.transition_options";

describe("AnnouncementsProjection transitions", () => {
  let wrapper: VueWrapper | null = null;
  let authority: AnnouncementsPresentationAuthority;

  function wireProducer(): void {
    const producer = (message: { type: string; payload: unknown }) => {
      if (message.type === BROADCAST_TYPE.ANNOUNCEMENTS_INTENT) {
        const packet = authority.publish(message.payload);
        if (packet) Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, packet);
      } else if (message.type === BROADCAST_TYPE.ANNOUNCEMENTS_CONTROL) {
        const packet = authority.control(message.payload);
        if (packet) Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, packet);
      } else if (message.type === BROADCAST_TYPE.REQUEST_ANNOUNCEMENTS_STATE) {
        const packet = authority.current();
        if (packet) Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, packet);
      }
    };
    mocks.listeners.add(producer);
  }

  /** Escreve direto no store — sem passar pelo UserData.set (persistência/broadcast). */
  function setOption(path: string, value: unknown): void {
    useUserDataStore().SET_PATH({ path, value });
  }

  function start(index: number, deck: AnnouncementSlide[] = slides): void {
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_INTENT, {
      ...beginAnnouncementIntent(),
      slides: deck,
      index,
    });
    // O VTU stuba Transition por padrão; aqui o teste É a transição real.
    wrapper = mount(AnnouncementsProjection, {
      attachTo: document.body,
      global: { stubs: { Transition: false } },
    });
  }

  function control(action: "next" | "prev"): void {
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_CONTROL, {
      action,
      announcement_session: authority.current()!.announcement_session,
    });
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    authority = new AnnouncementsPresentationAuthority();
    wireProducer();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    mocks.listeners.clear();
  });

  it("applies the fade transition classes while a slide changes", async () => {
    setOption(KEY_TYPE, "fade");
    start(0);
    await nextTick();
    expect(wrapper!.find(".ann-text").text()).toContain("Slide A");

    control("next");
    await nextTick();

    expect(wrapper!.find(".lj-t-fade-enter-active").exists()).toBe(true);
    expect(wrapper!.find(".lj-t-fade-leave-active").exists()).toBe(true);
    // Durante a animação os dois slides coexistem (saída + entrada).
    const texts = wrapper!.findAll(".ann-text").map((n) => n.text());
    expect(texts.join(" ")).toContain("Slide A");
    expect(texts.join(" ")).toContain("Slide B");
  });

  it("points the slide direction backwards when navigating to a previous slide", async () => {
    setOption(KEY_TYPE, "slide");
    start(1);
    await nextTick();
    const before = wrapper!.find(".lj-tstage").attributes("style") ?? "";
    expect(before).toContain("--ent-x: 100%");

    control("prev");
    await nextTick();

    const style = wrapper!.find(".lj-tstage").attributes("style") ?? "";
    expect(style).toContain("--ent-x: -100%");
    expect(style).toContain("--lv-x: 100%");
  });

  it("uses the vertical axis for the slide when the direction is vertical", async () => {
    setOption(KEY_TYPE, "slide");
    setOption(`${OPT}.dir`, "vertical");
    start(0);
    await nextTick();

    const style = wrapper!.find(".lj-tstage").attributes("style") ?? "";
    expect(style).toContain("--ent-y: 100%");
    expect(style).toContain("--lv-y: -100%");
    expect(style).toContain("--ent-x: 0%");
  });

  it("exposes the fade style variables on the stage", async () => {
    setOption(KEY_TYPE, "fade");
    setOption(`${OPT}.fade_style`, "blur");
    start(0);
    await nextTick();
    expect(wrapper!.find(".lj-tstage").attributes("style")).toContain("--fade-blur: 12px");

    setOption(`${OPT}.fade_style`, "through_bg");
    await nextTick();
    expect(wrapper!.find(".lj-tstage").attributes("style")).toContain("--fade-delay: 500ms");
  });

  it("starts zoom growing from the configured scale and origin", async () => {
    setOption(KEY_TYPE, "zoom");
    setOption(`${OPT}.zoom`, "in");
    setOption(`${OPT}.zoom_origin`, "top");
    start(0);
    await nextTick();

    const style = wrapper!.find(".lj-tstage").attributes("style") ?? "";
    expect(style).toContain("--zoom-from: 0.94");
    expect(style).toContain("--zoom-origin: 50% 0%");
  });

  it("exposes the configured timing function and falls back to ease", async () => {
    setOption(KEY_TYPE, "fade");
    setOption(`${OPT}.ease`, "ease-in");
    start(0);
    await nextTick();
    expect(wrapper!.find(".lj-tstage").attributes("style")).toContain("--trans-ease: ease-in");

    setOption(`${OPT}.ease`, "not-a-curve");
    await nextTick();
    const fallback = wrapper!.find(".lj-tstage").attributes("style") ?? "";
    expect(fallback).toContain("--trans-ease: ease");
    expect(fallback).not.toContain("ease-in");
  });

  it.each([
    ["flip", ".lj-t-flip-enter-active", ".lj-t-flip-leave-active"],
    ["circle", ".lj-t-circle-enter-active", ".lj-t-circle-leave-active"],
    ["split", ".lj-t-split-enter-active", ".lj-t-split-leave-active"],
  ])("applies the %s transition classes while a slide changes", async (type, enterSel, leaveSel) => {
    setOption(KEY_TYPE, type);
    start(0);
    await nextTick();

    control("next");
    await nextTick();

    expect(wrapper!.find(enterSel).exists()).toBe(true);
    expect(wrapper!.find(leaveSel).exists()).toBe(true);
  });

  it("exposes the configured duration on the stage for the CSS animations", async () => {
    setOption(KEY_DURATION, 800);
    start(0);
    await nextTick();

    expect(wrapper!.find(".lj-tstage").attributes("style")).toContain("--trans-dur: 800ms");
  });

  it("falls back to contain-like defaults when the type is unknown", async () => {
    setOption(KEY_TYPE, "not-a-transition");
    start(0);
    await nextTick();

    control("next");
    await nextTick();

    expect(wrapper!.find(".lj-t-none-enter-active").exists()).toBe(true);
    expect(wrapper!.find(".lj-t-none-leave-active").exists()).toBe(true);
  });

  it("keeps each slide's own background while the transition runs", async () => {
    setOption(KEY_TYPE, "fade");
    start(0, [
      { id: "a", nome: "A", ordem: 1, texto: "Slide A", style: { bgColor: "#010203" } },
      { id: "b", nome: "B", ordem: 2, texto: "Slide B", style: { bgColor: "#040506" } },
    ]);
    await nextTick();

    control("next");
    await nextTick();

    // Saindo e entrando coexistem: cada um carrega o próprio fundo.
    const backgrounds = wrapper!
      .findAll(".lj-tslide")
      .map((s) => (s.element as HTMLElement).style.backgroundColor);
    expect(backgrounds).toHaveLength(2);
    expect(new Set(backgrounds)).toEqual(new Set(["rgb(1, 2, 3)", "rgb(4, 5, 6)"]));
  });

  function closeAnnouncements(): void {
    const closed = authority.control({
      action: "stop",
      announcement_session: authority.current()!.announcement_session,
    });
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, closed);
  }

  it("clears the slide in its own window when the announcements stop", async () => {
    start(0);
    await nextTick();
    expect(wrapper!.find(".ann-text").exists()).toBe(true);

    closeAnnouncements();
    await nextTick();

    expect(wrapper!.find(".ann-text").exists()).toBe(false);
  });

  it("keeps the last slide inside the background window so it can fade out", async () => {
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_INTENT, {
      ...beginAnnouncementIntent(),
      slides,
      index: 0,
    });
    wrapper = mount(AnnouncementsLayer, {
      attachTo: document.body,
      props: { holdLastSlideOnClose: true },
      global: { stubs: { Transition: false } },
    });
    await nextTick();
    expect(wrapper.find(".ann-text").text()).toContain("Slide A");

    closeAnnouncements();
    await nextTick();

    expect(wrapper.find(".ann-text").text()).toContain("Slide A");
  });
});
