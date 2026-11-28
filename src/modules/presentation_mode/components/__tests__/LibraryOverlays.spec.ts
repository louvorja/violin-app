import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { createOverlaySlot, type OverlaySlot } from "@/types/Overlay";

const { slots, readAllSlots, writeSlot, userdata, send, openModule, error, listeners } = vi.hoisted(
  () => ({
    slots: { value: [] as OverlaySlot[] },
    readAllSlots: vi.fn(async () => slots.value),
    writeSlot: vi.fn(async () => {}),
    userdata: { get: vi.fn(() => false), set: vi.fn() },
    send: vi.fn(),
    openModule: vi.fn(),
    error: vi.fn(),
    listeners: new Map<string, (_payload: unknown) => void>(),
  })
);

vi.mock("@/helpers/Overlay", () => ({
  readAllSlots,
  writeSlot,
  getImage: vi.fn(async () => null),
  resolveImageUrl: vi.fn(() => ""),
}));
vi.mock("@/helpers/UserData", () => ({ default: userdata }));
vi.mock("@/helpers/Broadcast", () => ({ default: { send } }));
vi.mock("@/helpers/Modules", () => ({ default: { open: openModule } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { error } }));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, handler: (_payload: unknown) => void) => {
    listeners.set(type, handler);
  },
}));
vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    t: (key: string) => key,
    tm: (key: string) => key,
  }),
}));
vi.mock("@/composables/useModuleMirror", () => ({
  useModuleMirror: () => ({
    mirrorText: (source: string | null) => (source ? "00:01:00" : ""),
    mirrorColor: () => "",
  }),
}));

import LibraryOverlays from "../LibraryOverlays.vue";

function mountPanel() {
  return mount(LibraryOverlays, {
    global: {
      stubs: {
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjContextMenu: { props: ["quick", "items"], template: "<div><slot /></div>" },
        LjEmpty: {
          props: ["title", "icon"],
          template: '<div class="empty">{{ title }}<slot /></div>',
        },
        LjIcon: true,
        LjSwitch: {
          props: { modelValue: Boolean, label: String },
          emits: ["update:modelValue"],
          template:
            '<button class="switch-stub" :data-on="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />',
        },
        OverlaySlotPreview: { props: ["overlay"], template: '<div class="preview-stub" />' },
      },
    },
  });
}

const card = (id: string) => `[data-testid="pm-ovl-card-${id}"]`;

describe("LibraryOverlays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    slots.value = [];
    userdata.get.mockReturnValue(false);
  });

  it("lista as sobreposições e indica as ativas", async () => {
    userdata.get.mockReturnValue(true);
    slots.value = [
      createOverlaySlot({ id: "s1", name: "Aviso", enabled: true, order: 0 }),
      createOverlaySlot({ id: "s2", name: "Logo", enabled: false, order: 1 }),
    ];
    const wrapper = mountPanel();
    await flushPromises();

    const ativo = wrapper.get(card("s1"));
    expect(ativo.attributes("aria-pressed")).toBe("true");
    expect(ativo.classes()).toContain("pm-ovl__card--active");
    expect(ativo.text()).toContain("library.on_air");
    expect(ativo.text()).toContain("Aviso");
    expect(wrapper.get(card("s2")).attributes("aria-pressed")).toBe("false");
    expect(wrapper.findAll(".preview-stub")).toHaveLength(2);
  });

  it("marca como pronta a sobreposição habilitada com a chave geral desligada", async () => {
    slots.value = [createOverlaySlot({ id: "s1", name: "Aviso", enabled: true })];
    userdata.get.mockReturnValue(false);
    const wrapper = mountPanel();
    await flushPromises();

    const cardElement = wrapper.get(card("s1"));
    expect(cardElement.attributes("aria-pressed")).toBe("false");
    expect(cardElement.text()).toContain("library.overlays_ready");
    expect(cardElement.text()).not.toContain("library.on_air");
  });

  it("filtra somente as ativas pelo contador da chave geral", async () => {
    userdata.get.mockReturnValue(true);
    slots.value = [
      createOverlaySlot({ id: "s1", name: "Aviso", enabled: true }),
      createOverlaySlot({ id: "s2", name: "Logo", enabled: false, order: 1 }),
    ];
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.findAll(".pm-ovl__card")).toHaveLength(2);

    await wrapper.get('[data-testid="pm-ovl-filter"]').trigger("click");
    expect(wrapper.get('[data-testid="pm-ovl-filter"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.find(card("s1")).exists()).toBe(true);
    expect(wrapper.find(card("s2")).exists()).toBe(false);

    await wrapper.get(card("s1")).trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("library.overlays_none_active");

    await wrapper.get(".pm-ovl__message button").trigger("click");
    expect(wrapper.get('[data-testid="pm-ovl-filter"]').attributes("aria-pressed")).toBe("false");
    expect(wrapper.findAll(".pm-ovl__card")).toHaveLength(2);
  });

  it("mantém os cards quando uma leitura posterior falha", async () => {
    slots.value = [createOverlaySlot({ id: "s1", name: "Aviso" })];
    const wrapper = mountPanel();
    await flushPromises();

    readAllSlots.mockRejectedValueOnce(new Error("idb"));
    listeners.get(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED)?.({});
    await flushPromises();

    expect(wrapper.find(".pm-ovl__banner").exists()).toBe(true);
    expect(wrapper.find(card("s1")).exists()).toBe(true);

    await wrapper.get(".pm-ovl__banner button").trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-ovl__banner").exists()).toBe(false);
  });

  it("oferece tentar de novo quando a primeira leitura falha", async () => {
    readAllSlots.mockRejectedValueOnce(new Error("idb"));
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.text()).toContain("library.overlays_load_error");
    expect(wrapper.find(".pm-ovl__card").exists()).toBe(false);

    slots.value = [createOverlaySlot({ id: "s1", name: "Aviso" })];
    await wrapper.get(".pm-ovl__message button").trigger("click");
    await flushPromises();

    expect(wrapper.find(card("s1")).exists()).toBe(true);
  });

  it("clicar ativa a sobreposição e liga a chave geral", async () => {
    slots.value = [createOverlaySlot({ id: "s1", name: "Aviso", enabled: false })];
    userdata.get.mockReturnValue(false);
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get(card("s1")).trigger("click");
    await flushPromises();

    expect(writeSlot).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", enabled: true }));
    expect(userdata.set).toHaveBeenCalledWith(KEYS.MODULES.OVERLAY.ENABLED, true);
    expect(send).toHaveBeenCalledWith(
      BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED,
      expect.objectContaining({ slot: expect.objectContaining({ id: "s1", enabled: true }) })
    );
  });

  it("clicar de novo desativa e desliga a chave quando era o último", async () => {
    slots.value = [createOverlaySlot({ id: "s1", name: "Aviso", enabled: true })];
    userdata.get.mockReturnValue(true);
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get(card("s1")).trigger("click");
    await flushPromises();

    expect(writeSlot).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", enabled: false }));
    expect(userdata.set).toHaveBeenCalledWith(KEYS.MODULES.OVERLAY.ENABLED, false);
  });

  it("mantém a chave ligada quando outra sobreposição continua ativa", async () => {
    slots.value = [
      createOverlaySlot({ id: "s1", name: "Aviso", enabled: true }),
      createOverlaySlot({ id: "s2", name: "Logo", enabled: true, order: 1 }),
    ];
    userdata.get.mockReturnValue(true);
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get(card("s1")).trigger("click");
    await flushPromises();

    expect(userdata.set).not.toHaveBeenCalledWith(KEYS.MODULES.OVERLAY.ENABLED, false);
  });

  it("o interruptor geral liga e desliga todas", async () => {
    slots.value = [createOverlaySlot({ id: "s1", name: "Aviso" })];
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get('[data-testid="pm-ovl-master"]').trigger("click");

    expect(userdata.set).toHaveBeenCalledWith(KEYS.MODULES.OVERLAY.ENABLED, true);
    expect(send).toHaveBeenCalledWith(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, { enabled: true });
  });

  it("recarrega quando outra janela muda as sobreposições", async () => {
    slots.value = [createOverlaySlot({ id: "s1", name: "Antiga" })];
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("Antiga");

    slots.value = [createOverlaySlot({ id: "s1", name: "Nova" })];
    listeners.get(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED)?.({});
    await flushPromises();

    expect(wrapper.text()).toContain("Nova");
  });

  it("sem sobreposições, abre o módulo", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find(".empty").text()).toContain("library.overlays_empty");
    await wrapper.get(".empty button").trigger("click");
    expect(openModule).toHaveBeenCalledWith(ModuleEnum.OVERLAY);
  });

  it("avisa quando não consegue gravar", async () => {
    slots.value = [createOverlaySlot({ id: "s1", name: "Aviso", enabled: false })];
    writeSlot.mockRejectedValueOnce(new Error("disco"));
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get(card("s1")).trigger("click");
    await flushPromises();

    expect(error).toHaveBeenCalledWith("library.overlays_toggle_failed");
  });
});
