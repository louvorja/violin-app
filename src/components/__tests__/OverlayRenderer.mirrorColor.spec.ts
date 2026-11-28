import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import $userdata from "@/helpers/UserData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { ModulePresentationAuthority } from "@/presentation/ModulePresentationState";
import { createOverlaySlot, type OverlaySlot } from "@/types/Overlay";
import { STAGE_UNITS } from "@/helpers/OverlayStyle";
import OverlayRenderer from "../OverlayRenderer.vue";

const stored = vi.hoisted(() => ({ slots: [] as unknown[] }));

vi.mock("@/helpers/Overlay", () => ({
  readAllSlots: async () => stored.slots,
  getImage: async () => null,
  resolveImageUrl: () => "",
}));

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });

/**
 * O espelho do temporizador na projeção ficava na cor da sobreposição enquanto o
 * módulo já estava no amarelo/vermelho (#80): o pacote trazia a cor, e só o texto
 * era lido.
 */
describe("espelho de módulo na projeção: cor de aviso e alerta (#80)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);
  });

  afterEach(() => {
    stored.slots = [];
  });

  async function mountWith(slots: OverlaySlot[]) {
    stored.slots = slots;
    const wrapper = mount(OverlayRenderer, { global: { plugins: [i18n] } });
    await flushPromises();
    return wrapper;
  }

  it("pinta o espelho com a cor que o módulo publicou e volta à da sobreposição depois", async () => {
    const mirror = createOverlaySlot({
      id: "espelho",
      type: "module_mirror",
      source_module: ModuleEnum.TIMER_WORSHIP,
    });
    mirror.style.color = "#FFFFFF";
    const livre = createOverlaySlot({ id: "livre", type: "text", content: "Bem-vindos", order: 1 });
    livre.style.color = "#00FF00";
    const wrapper = await mountWith([mirror, livre]);

    const authority = new ModulePresentationAuthority();
    const publish = async (value: Record<string, unknown>) => {
      Broadcast.send(
        BROADCAST_TYPE.MODULE_PROJECTION_VALUE,
        authority.publish({ module: ModuleEnum.TIMER_WORSHIP, active: true, ...value })
      );
      await flushPromises();
    };
    const textOf = (id: string) =>
      wrapper.get(`[data-slot-id="${id}"] .overlay-slot__text`).element as HTMLElement;

    await publish({ text: "00:05:00" });
    expect(textOf("espelho").textContent?.trim()).toBe("00:05:00");
    expect(textOf("espelho").style.color).toBe("rgb(255, 255, 255)");

    await publish({ text: "00:00:59", color: "#F59E0B", alert: "warning" });
    expect(textOf("espelho").style.color).toBe("rgb(245, 158, 11)");
    expect(textOf("livre").style.color).toBe("rgb(0, 255, 0)");

    await publish({ text: "-00:00:03", color: "#E74C3C", alert: "danger" });
    expect(textOf("espelho").style.color).toBe("rgb(231, 76, 60)");

    await publish({ text: "00:10:00" });
    expect(textOf("espelho").style.color).toBe("rgb(255, 255, 255)");
  });

  it("embutido usa unidades do palco e deixa de cobrir a janela", async () => {
    stored.slots = [
      createOverlaySlot({ id: "texto", type: "text", content: "Bem-vindos" }),
      createOverlaySlot({ id: "foto", type: "image", file_id: "img", content: "", order: 1 }),
    ];
    const wrapper = mount(OverlayRenderer, {
      props: { embedded: true, units: STAGE_UNITS },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const canvas = wrapper.get(".overlay-canvas");
    expect(canvas.classes()).toContain("overlay-canvas--embedded");
    expect(
      (wrapper.get('[data-slot-id="texto"] .overlay-slot__text').element as HTMLElement).style
        .fontSize
    ).toBe("5cqh");
    expect(
      (wrapper.get('[data-slot-id="foto"] .overlay-slot__img').element as HTMLElement).style
        .maxWidth
    ).toContain("cqw");
  });
});
