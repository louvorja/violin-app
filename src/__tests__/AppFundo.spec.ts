import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "@/App.vue";

/**
 * A raiz do app não pode pintar fundo nas rotas de captura e de projeção.
 *
 * `/obs` e `/obs/bible` viram Browser Source no OBS: uma superfície opaca ali
 * cobre a câmera com um retângulo branco, que fica na transmissão enquanto não
 * houver slide. Em `/projection` o preto vem do index.html justamente para não
 * haver lampejo branco antes de o slide entrar por fade — no telão, diante da
 * congregação. Nenhum dos dois acusa nada no console.
 */
const Vazio = defineComponent({ setup: () => () => h("div") });

async function montarEm(path: string) {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: "/", component: Vazio },
      { path: "/obs", component: Vazio },
      { path: "/obs/bible", component: Vazio },
      { path: "/projection", component: Vazio },
      { path: "/projection/return", component: Vazio },
      { path: "/clock", component: Vazio },
    ],
  });
  await router.push(path);
  await router.isReady();
  const w = mount(App, {
    global: {
      plugins: [router],
      stubs: { AppLoading: true, WebFullscreenPrompt: true, TooltipProvider: false },
    },
  });
  return w;
}

describe("fundo da raiz do app", () => {
  it("não pinta nas rotas de captura e de projeção", async () => {
    for (const rota of ["/obs", "/obs/bible", "/projection", "/projection/return"]) {
      const w = await montarEm(rota);
      expect(w.get("#app-container").classes(), rota).toContain("is-transparente");
      w.unmount();
    }
  });

  it("pinta nas rotas de interface", async () => {
    for (const rota of ["/", "/clock"]) {
      const w = await montarEm(rota);
      expect(w.get("#app-container").classes(), rota).not.toContain("is-transparente");
      w.unmount();
    }
  });
});
