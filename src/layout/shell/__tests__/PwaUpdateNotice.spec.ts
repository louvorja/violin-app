import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, type Ref, type ShallowRef } from "vue";
import { makeI18n } from "@/components/ui/__tests__/mountUi";
import type { PwaUpdateState } from "@/helpers/PwaUpdates";

const probe = vi.hoisted(() => ({
  isDesktop: false,
  state: null as unknown as ShallowRef<PwaUpdateState>,
  blocked: null as unknown as Ref<boolean>,
  apply: vi.fn(async () => true),
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() {
      return probe.isDesktop;
    },
  },
}));
vi.mock("@/composables/usePwaUpdates", async () => {
  const { ref, shallowRef } = await import("vue");
  probe.state = shallowRef<PwaUpdateState>({ status: "idle", ready: false, lastCheckedAt: null });
  probe.blocked = ref(false);
  return {
    usePwaUpdates: () => ({ state: probe.state, blocked: probe.blocked, apply: probe.apply }),
  };
});

import PwaUpdateNotice from "../PwaUpdateNotice.vue";

beforeEach(() => {
  probe.isDesktop = false;
  probe.state.value = { status: "idle", ready: false, lastCheckedAt: null };
  probe.blocked.value = false;
  probe.apply.mockClear();
});

const mountNotice = (locale: "pt" | "es" = "pt") =>
  mount(PwaUpdateNotice, { global: { plugins: [makeI18n(locale)] } });

describe("aviso persistente de atualização PWA", () => {
  it("só aparece com atualização pronta e nunca aplica ao receber o aviso", async () => {
    const wrapper = mountNotice();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);

    probe.state.value = { status: "ready", ready: true, lastCheckedAt: Date.now() };
    await nextTick();

    expect(wrapper.text()).toContain("Atualização do app pronta");
    expect(wrapper.text()).toContain("Salve suas alterações");
    expect(probe.apply).not.toHaveBeenCalled();
    await wrapper.get("button").trigger("click");
    expect(probe.apply).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("mantém o aviso bloqueado e libera a ação quando o trabalho termina", async () => {
    probe.state.value = { status: "ready", ready: true, lastCheckedAt: null };
    probe.blocked.value = true;
    const wrapper = mountNotice();

    expect(wrapper.text()).toContain("Salve e feche o editor");
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    await wrapper.get("button").trigger("click");
    expect(probe.apply).not.toHaveBeenCalled();

    probe.blocked.value = false;
    await nextTick();
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(wrapper.get("button").attributes("disabled")).toBeUndefined();
    await wrapper.get("button").trigger("click");
    expect(probe.apply).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("bloqueia outro clique enquanto aplica e conserva uma falha visível para tentar de novo", async () => {
    probe.state.value = { status: "applying", ready: true, lastCheckedAt: null };
    const wrapper = mountNotice();
    expect(wrapper.text()).toContain("Preparando atualização");
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button").attributes("aria-busy")).toBe("true");

    probe.state.value = { status: "error", ready: true, lastCheckedAt: null };
    await nextTick();
    expect(wrapper.text()).toContain("Não foi possível concluir a atualização");
    expect(wrapper.get("button").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("localiza a ação em espanhol e não mostra este fluxo no desktop", () => {
    probe.state.value = { status: "ready", ready: true, lastCheckedAt: null };
    const web = mountNotice("es");
    expect(web.get("button").text()).toBe("Actualizar y recargar");
    web.unmount();

    probe.isDesktop = true;
    const desktop = mountNotice();
    expect(desktop.find('[role="status"]').exists()).toBe(false);
    desktop.unmount();
  });
});
