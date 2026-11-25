import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, type VNodeChild } from "vue";
import { KEYS } from "@/constants/UserDataKeys";

const userdata = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/helpers/UserData", () => ({
  default: { get: userdata.get, set: userdata.set },
}));
vi.mock("vuedraggable", async () => {
  const { h } = await import("vue");
  return {
    default: {
      name: "DraggableStub",
      props: ["modelValue", "itemKey"],
      emits: ["update:modelValue", "start", "end"],
      setup(
        props: { modelValue?: unknown[] },
        { slots }: { slots: { item?: (_arg: { element: unknown }) => VNodeChild } }
      ) {
        return () =>
          h(
            "div",
            { class: "pm-library__tablist-inner" },
            (props.modelValue ?? [])
              .map((element) => slots.item?.({ element }))
              .filter((child): child is VNodeChild => child !== undefined)
          );
      },
    },
  };
});

vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    t: (key: string) => key,
    tm: (key: string) => key,
  }),
}));
vi.mock("@/modules/presentation_mode/composables/useVerticalResize", () => ({
  useVerticalResize: () => ({ start: vi.fn(), step: vi.fn() }),
}));
vi.mock("../LibraryFiles.vue", () => ({
  default: { name: "LibraryFiles", template: "<div />" },
}));
vi.mock("../LibraryMusic.vue", () => ({
  default: { name: "LibraryMusic", template: "<div />" },
}));
vi.mock("../LibraryBible.vue", () => ({
  default: { name: "LibraryBible", template: "<div />" },
}));
vi.mock("../LibraryBackgroundSound.vue", () => ({
  default: { name: "LibraryBackgroundSound", template: "<div />" },
}));
vi.mock("../LibraryBackgroundProjection.vue", () => ({
  default: { name: "LibraryBackgroundProjection", template: "<div />" },
}));
vi.mock("../LibraryMedia.vue", () => ({
  default: { name: "LibraryMedia", template: "<div />" },
}));
vi.mock("../LibraryNativeMedia.vue", () => ({
  default: { name: "LibraryNativeMedia", template: "<div />" },
}));

import LibraryPanel from "../LibraryPanel.vue";

function mountPanel() {
  return mount(LibraryPanel, {
    props: {
      fullWidth: false,
      tall: false,
      height: 244,
      livePath: null,
      returnPath: null,
      liveBible: null,
      liveVideoId: null,
      liveSongId: null,
    },
    global: {
      stubs: {
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjIcon: true,
      },
    },
  });
}

describe("LibraryPanel tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userdata.get.mockReturnValue([]);
  });

  it("respeita a ordem salva e acrescenta abas novas no fim", () => {
    userdata.get.mockReturnValue(["bible", "files", "apagada"]);

    const wrapper = mountPanel();
    const ids = wrapper.findAll('[role="tab"]').map((tab) => tab.attributes("data-testid"));

    expect(ids.slice(0, 2)).toEqual(["pm-library-tab-bible", "pm-library-tab-files"]);
    expect(ids.slice(2, 4)).toEqual(["pm-library-tab-media", "pm-library-tab-online_videos"]);
    expect(ids).toHaveLength(9);
  });

  it("insere a aba nova depois de Mídia numa ordem já salva", () => {
    userdata.get.mockReturnValue(["files", "media", "musics"]);

    const wrapper = mountPanel();
    const ids = wrapper.findAll('[role="tab"]').map((tab) => tab.attributes("data-testid"));

    expect(ids.indexOf("pm-library-tab-online_videos")).toBe(
      ids.indexOf("pm-library-tab-media") + 1
    );
    expect(ids.indexOf("pm-library-tab-online_videos")).toBeLessThan(
      ids.indexOf("pm-library-tab-musics")
    );
  });

  it("salva a nova ordem quando o usuário arrasta as abas", async () => {
    const wrapper = mountPanel();
    const sortable = wrapper.findComponent({ name: "DraggableStub" });

    sortable.vm.$emit("update:modelValue", [{ id: "bible" }, { id: "files" }]);
    await nextTick();

    expect(userdata.set).toHaveBeenCalledWith(
      KEYS.MODULES.PRESENTATION_MODE.LIBRARY_TAB_ORDER,
      [
        "bible",
        "files",
        "media",
        "online_videos",
        "media_library",
        "audio",
        "background_sound",
        "background_projection",
        "musics",
      ]
    );
  });

  it("não troca de aba no clique que fecha o arraste e libera o próximo", async () => {
    const wrapper = mountPanel();
    const sortable = wrapper.findComponent({ name: "DraggableStub" });

    sortable.vm.$emit("start");
    await nextTick();
    expect(wrapper.find(".pm-library__tablist").classes()).toContain(
      "pm-library__tablist--dragging"
    );

    sortable.vm.$emit("end");
    await nextTick();
    expect(wrapper.find(".pm-library__tablist").classes()).not.toContain(
      "pm-library__tablist--dragging"
    );

    const media = wrapper.find('[data-testid="pm-library-tab-media"]');
    await media.trigger("click");
    expect(wrapper.emitted("update:tab")).toBeUndefined();

    await media.trigger("click");
    expect(wrapper.emitted("update:tab")?.at(-1)).toEqual(["media"]);
  });

  it("converte a roda vertical em rolagem horizontal das abas", async () => {
    const wrapper = mountPanel();

    const list = wrapper.find(".pm-library__tablist").element as HTMLElement;
    Object.defineProperty(list, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(list, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });

    await wrapper.find(".pm-library__tablist").trigger("wheel", { deltaY: 120, deltaMode: 0 });

    expect(list.scrollLeft).toBe(120);
  });

  it("revela a aba ativa quando o ribbon escolhe uma aba fora da faixa", async () => {
    const wrapper = mountPanel();

    const list = wrapper.find(".pm-library__tablist").element as HTMLElement;
    const active = wrapper.find('[data-testid="pm-library-tab-bible"]').element as HTMLElement;
    let scrollLeft = 0;
    Object.defineProperty(list, "scrollLeft", {
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = Number(value) || 0;
      },
      configurable: true,
    });
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 200,
      top: 0,
      bottom: 30,
      width: 200,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(active, "getBoundingClientRect").mockImplementation(() => {
      const left = 300 - scrollLeft;
      return {
        left,
        right: left + 60,
        top: 0,
        bottom: 30,
        width: 60,
        height: 30,
        x: left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    await wrapper.find('[data-testid="pm-library-tab-bible"]').trigger("click");
    await flushPromises();

    expect(list.scrollLeft).toBe(160);
  });
});
