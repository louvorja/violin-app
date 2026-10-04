import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import RemoteSlides from "../RemoteSlides.vue";

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });
const slides = [{ lyric: "Capa" }, { lyric: "Verso" }, { lyric: "Amém" }];

function abrir() {
  return mount(RemoteSlides, {
    props: { slides, currentSlideIndex: 0, currentTitle: "A música" },
    global: { plugins: [i18n] },
  });
}

describe("grade de slides do controle remoto", () => {
  it("devolve a escolha ao pai em vez de postar por conta própria", async () => {
    const wrapper = abrir();
    const cards = wrapper.findAll(".rs-slide");
    expect(cards).toHaveLength(3);

    await cards[2].trigger("click");

    // O pai tem a sessão observada e monta o comando. A tela não pode fazer o
    // próprio POST: foi assim que ela ficou mandando `go-to-slide` sem
    // `presentation_session`, que o desktop descarta — o clique mudava o
    // desenho na hora (update otimista) e não acontecia nada na projeção.
    expect(wrapper.emitted("go-to-slide")).toEqual([[2]]);
    // O índice é do pai: ele já atualiza na hora e monta o comando com a
    // sessão. Um `v-model` aqui duplicaria o dono do estado.
    expect(wrapper.emitted("update:current-slide-index")).toBeUndefined();
    wrapper.unmount();
  });

  it("sem deck não há grade para clicar", () => {
    const wrapper = mount(RemoteSlides, {
      props: { slides: [], currentSlideIndex: 0, currentTitle: "" },
      global: { plugins: [i18n] },
    });
    expect(wrapper.findAll(".rs-slide")).toHaveLength(0);
    wrapper.unmount();
  });

  it("marca o slide informado como o que está no ar", () => {
    const wrapper = mount(RemoteSlides, {
      props: { slides, currentSlideIndex: 1, currentTitle: "A música" },
      global: { plugins: [i18n] },
    });
    const ativos = wrapper.findAll(".rs-slide.is-active");
    expect(ativos).toHaveLength(1);
    expect(ativos[0].text()).toContain("2");
    wrapper.unmount();
  });
});