import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import OpeningBar from "../OpeningBar.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import pt from "@/lang/pt.json";
import es from "@/lang/es.json";

type Opening = { id: string | null; title: string } | null;

const cancelOpening = vi.fn();
vi.mock("@/composables/useMedia", async () => {
  const { shallowRef } = await import("vue");
  const state = shallowRef<Opening>(null);
  return {
    default: { opening: () => state.value, cancelOpening: () => cancelOpening() },
    __state: state,
  };
});

let toast = false;
vi.mock("@/helpers/AppData", () => ({
  default: { get: (_key: string, fallback?: unknown) => (toast ? true : fallback) },
}));

const { __state: state } = (await import("@/composables/useMedia")) as unknown as {
  __state: { value: Opening };
};

beforeEach(() => {
  state.value = null;
  toast = false;
  cancelOpening.mockClear();
});

describe("OpeningBar — a resposta imediata ao clique de tocar", () => {
  it("não mostra nada quando nenhum vídeo está sendo aberto", () => {
    const wrapper = mountUi(OpeningBar);
    expect(wrapper.find(".opening").exists()).toBe(false);
  });

  it("mostra o vídeo que está abrindo, com o indicador de carregamento", async () => {
    const wrapper = mountUi(OpeningBar);
    state.value = { id: "kQWEGODrfKc", title: "Novo Hinário Adventista • Hino 202" };
    await nextTick();
    expect(wrapper.find(".opening").text()).toContain(
      `${pt.shell.opening}: Novo Hinário Adventista • Hino 202`
    );
    expect(wrapper.find(".lj-spinner").exists()).toBe(true);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it("some assim que o vídeo abre ou o pedido termina", async () => {
    state.value = { id: "kQWEGODrfKc", title: "Hino 202" };
    const wrapper = mountUi(OpeningBar);
    expect(wrapper.find(".opening").exists()).toBe(true);
    state.value = null;
    await nextTick();
    expect(wrapper.find(".opening").exists()).toBe(false);
  });

  it("o ✕ cancela a abertura", async () => {
    state.value = { id: "kQWEGODrfKc", title: "Hino 202" };
    const wrapper = mountUi(OpeningBar);
    await wrapper.find("button.opening__cancel").trigger("click");
    expect(cancelOpening).toHaveBeenCalledOnce();
  });

  it("o botão de cancelar tem nome acessível", () => {
    state.value = { id: null, title: "Hino 202" };
    const wrapper = mountUi(OpeningBar);
    expect(wrapper.find("button.opening__cancel").attributes("aria-label")).toBe(
      pt.shell.opening_cancel
    );
  });

  it("com um aviso na tela, não empilha por cima dele", () => {
    toast = true;
    state.value = { id: "kQWEGODrfKc", title: "Hino 202" };
    const wrapper = mountUi(OpeningBar);
    expect(wrapper.find(".opening").exists()).toBe(false);
  });

  it("fala espanhol quando o idioma é espanhol", () => {
    state.value = { id: null, title: "Himno 202" };
    const wrapper = mountUi(OpeningBar, {}, "es");
    expect(wrapper.find(".opening").text()).toContain(`${es.shell.opening}: Himno 202`);
  });
});
