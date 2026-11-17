import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import RemoteBackgroundSound from "../RemoteBackgroundSound.vue";

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });

const STATE = {
  status: "ok",
  playing: false,
  volume: 40,
  currentId: null,
  files: [
    { id: "s1", name: "Chuva", categoryId: "cat-1" },
    { id: "s2", name: "Mar", categoryId: "cat-1" },
    { id: "s3", name: "Avulso", categoryId: null },
  ],
  categories: [{ id: "cat-1", name: "Natureza", color: null }],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => STATE } as unknown as Response)
    )
  );
});

function abrir() {
  return mount(RemoteBackgroundSound, {
    props: { token: "tk" },
    global: {
      plugins: [i18n],
      stubs: { LjIcon: true, LjSpinner: true },
    },
  });
}

describe("RemoteBackgroundSound — categorias", () => {
  it("recolhe e reabre os sons do grupo ao clicar no cabeçalho", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.findAll(".rbs-category")).toHaveLength(2);
    expect(wrapper.findAll(".rbs-sound")).toHaveLength(3);

    const cabecalho = wrapper.findAll(".rbs-category")[0];
    expect(cabecalho.text()).toContain("Natureza");
    expect(cabecalho.find(".rbs-category__count").text()).toBe("2");

    await cabecalho.trigger("click");
    // Cabeçalhos ficam (com a contagem); só os sons do grupo somem.
    expect(wrapper.findAll(".rbs-category")).toHaveLength(2);
    expect(wrapper.findAll(".rbs-sound")).toHaveLength(1);
    expect(wrapper.find(".rbs-sound").text()).toContain("Avulso");
    expect(wrapper.findAll(".rbs-category")[0].attributes("aria-expanded")).toBe("false");

    await wrapper.findAll(".rbs-category")[0].trigger("click");
    expect(wrapper.findAll(".rbs-sound")).toHaveLength(3);
    expect(wrapper.findAll(".rbs-category")[0].attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });
});
