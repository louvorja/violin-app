import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import RendererApp from "../RendererApp.vue";
import { LjButton } from "@/components/ui";

/**
 * As janelas auxiliares (controle remoto, popup, operador) têm raiz própria.
 * Sem o provider de tooltip nela, todo botão só de ícone com `title` quebrava
 * ao montar — no controle remoto, 65 erros numa manhã, com botões sumindo.
 */
describe("RendererApp", () => {
  it("monta um botão só de ícone com dica sem erro de provider", async () => {
    const Remote = defineComponent({
      render: () => h(LjButton, { iconOnly: true, icon: "player-play", title: "Tocar" }),
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/remote", component: Remote }],
    });
    await router.push("/remote");
    await router.isReady();
    const errors = vi.fn();
    const wrapper = mount(RendererApp, {
      global: { plugins: [router], config: { errorHandler: errors } },
    });
    await flushPromises();
    expect(errors).not.toHaveBeenCalled();
    expect(wrapper.find("button").exists()).toBe(true);
  });
});
