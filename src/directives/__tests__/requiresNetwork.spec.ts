import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, nextTick } from "vue";
import requiresNetwork from "@/directives/requiresNetwork";
import { reportNetworkResult, _resetConnectivity } from "@/composables/useConnectivity";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";

/**
 * O que esta diretiva evita: um botão que precisa de internet parecer normal
 * numa igreja sem internet. O operador clica no meio do culto, nada acontece —
 * ou pior, um diálogo modal aparece na frente da projeção.
 *
 * Ela existe como diretiva porque o alvo são dezenas de botões espalhados por
 * módulos independentes. Uma prop nova em cada componente seria a mesma regra
 * copiada dezenas de vezes, e a cópia esquecida só apareceria ao vivo.
 */
/** Monta um botão com a diretiva realmente aplicada via template. */
function montarComDiretiva(binding = "") {
  const cliques: string[] = [];
  const Comp = defineComponent({
    template: `<button v-requires-network${binding} @click="ok">Baixar</button>`,
    setup() {
      return { ok: () => cliques.push("clicou") };
    },
  });
  const wrapper = mount(Comp, {
    global: { directives: { "requires-network": requiresNetwork } },
  });
  return { wrapper, cliques };
}

describe("v-requires-network", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetConnectivity();
    $appdata.set(KEYS.SHELL.IS_ONLINE, true);
  });

  it("com rede, o botão funciona normalmente", async () => {
    const { wrapper, cliques } = montarComDiretiva();
    await wrapper.find("button").trigger("click");
    expect(cliques).toHaveLength(1);
    expect(wrapper.find("button").attributes("disabled")).toBeUndefined();
  });

  it("sem rede, desabilita e explica o motivo", async () => {
    const { wrapper } = montarComDiretiva();
    reportNetworkResult(false);
    reportNetworkResult(false);
    await nextTick();

    const botao = wrapper.find("button");
    expect(botao.attributes("aria-disabled")).toBe("true");
    expect(botao.attributes("title")).toBeTruthy();
    expect(botao.classes()).toContain("lj-requires-network--off");
  });

  it("volta ao normal quando a rede volta", async () => {
    const { wrapper } = montarComDiretiva();
    reportNetworkResult(false);
    reportNetworkResult(false);
    await nextTick();
    reportNetworkResult(true);
    await nextTick();

    const botao = wrapper.find("button");
    expect(botao.attributes("aria-disabled")).toBeUndefined();
    expect(botao.classes()).not.toContain("lj-requires-network--off");
  });

  it("com valor false, não bloqueia nada — a ação funciona offline", async () => {
    const { wrapper, cliques } = montarComDiretiva('="false"');
    reportNetworkResult(false);
    reportNetworkResult(false);
    await nextTick();

    expect(wrapper.find("button").classes()).not.toContain("lj-requires-network--off");
    await wrapper.find("button").trigger("click");
    expect(cliques).toHaveLength(1);
  });

  it("uma falha isolada não derruba o botão", async () => {
    // Um arquivo grande que estourou o prazo não pode desabilitar a interface.
    const { wrapper } = montarComDiretiva();
    reportNetworkResult(false);
    await nextTick();
    expect(wrapper.find("button").classes()).not.toContain("lj-requires-network--off");
  });
});
