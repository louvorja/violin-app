import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { VueWrapper } from "@vue/test-utils";
import FormatPanel from "@/components/FormatPanel.vue";
import { expectKeyExists, mountUi } from "@/components/ui/__tests__/mountUi";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock("@/helpers/UserData", async () => {
  const { reactive } = await import("vue");
  h.state = reactive<Record<string, unknown>>({});
  return {
    default: {
      get: (key: string, fallback?: unknown) => (key in h.state ? h.state[key] : fallback),
      set: (key: string, value: unknown) => {
        h.state[key] = value;
      },
    },
  };
});

vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

const MANIFEST = {
  id: "timer",
  customization: {
    font_color: { type: "color", default: "#FFFFFF" },
    clock_color_enabled: { type: "boolean", default: false },
    clock_color: { type: "color", default: "#FFFFFF", showWhen: "clock_color_enabled" },
  },
};

const montados: VueWrapper[] = [];

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
});

beforeEach(() => {
  for (const key of Object.keys(h.state)) delete h.state[key];
});

async function montar() {
  const wrapper = mountUi(FormatPanel, {
    props: { moduleId: "timer", manifest: MANIFEST },
  });
  montados.push(wrapper as unknown as VueWrapper);
  await flushPromises();
  return wrapper;
}

describe("FormatPanel — campo condicionado a um switch", () => {
  it("só mostra a cor do relógio depois de ligar o switch", async () => {
    const w = await montar();
    await vi.waitFor(() => expect(w.findAll('input[type="color"]')).toHaveLength(1));

    await w.get('input[type="checkbox"]').setValue(true);
    await flushPromises();
    await vi.waitFor(() => expect(w.findAll('input[type="color"]')).toHaveLength(2));

    await w.get('input[type="checkbox"]').setValue(false);
    await flushPromises();
    await vi.waitFor(() => expect(w.findAll('input[type="color"]')).toHaveLength(1));
  });

  it("os rótulos do novo campo existem nos dois idiomas", () => {
    expectKeyExists("components.customization.clock_color_toggle");
    expectKeyExists("components.customization.clock_color");
  });
});
