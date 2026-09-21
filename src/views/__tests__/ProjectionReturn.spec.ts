import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import $userdata from "@/helpers/UserData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import { SLIDE_STYLE_DEFAULT } from "@/config/SlideStyle";
import ProjectionReturn from "@/views/ProjectionReturn.vue";

const K = KEYS.OPTIONS.SLIDE;

const i18n = createI18n({
  legacy: false,
  locale: "pt",
  messages: { pt: { shell: { proj_return_next: "PRÓX" } } },
});

const CAPA = "https://exemplo.test/imagens/capa-do-album.jpg";

function slide(lyric: string, extra: Record<string, unknown> = {}) {
  return { lyric, cover: false, url_image: CAPA, id_music: 1, ...extra };
}

function enviar(atual: unknown, proximo: unknown, indice = 3, total = 12) {
  Broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, {
    slide_index: indice,
    slide: atual,
    next_slide: proximo,
    title: "Hino 1",
    progress: 30,
    total_slides: total,
  });
}

/**
 * O jsdom não calcula layout: caixa e texto medem zero e tudo "cabe". Serve
 * para o que não depende de medida — o que é desenhado, de onde vem o teto do
 * tamanho e o que o ajuste escreve no elemento. O encolher de verdade é
 * exercitado em FitText.spec.ts e conferido no navegador.
 */
describe("ProjectionReturn", () => {
  let wrapper: VueWrapper | null = null;
  const alturaOriginal = window.innerHeight;

  beforeEach(() => {
    setActivePinia(createPinia());
    for (const k of [
      K.CUSTOM_RETURN_TEXT_FORMAT,
      K.RETURN_FONT_SIZE_LYRIC,
      K.RETURN_FONT_SIZE_COVER,
      K.FONT_SIZE_NEXT,
      K.CUSTOM_RETURN_BACKGROUND,
      K.RETURN_BG_TOP_COLOR,
      K.SLIDES,
    ]) {
      $userdata.set(k, undefined);
    }
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    Object.defineProperty(window, "innerHeight", { value: alturaOriginal, configurable: true });
  });

  function montar() {
    wrapper = mount(ProjectionReturn, {
      attachTo: document.body,
      global: { plugins: [i18n], stubs: { OverlayRenderer: true } },
    });
    return wrapper;
  }

  it("não desenha a imagem do slide atrás da letra", async () => {
    const w = montar();
    enviar(slide("Santo, Santo, Santo<br>Deus onipotente"), slide("Cedo pela manhã"));
    await nextTick();

    expect(w.find(".return-text").exists()).toBe(true);
    expect(w.find(".return-bg").exists()).toBe(false);
    expect(w.html()).not.toContain("capa-do-album");
  });

  it("com fundo personalizado só de cor, pinta a cor e nenhuma imagem", async () => {
    $userdata.set(K.CUSTOM_RETURN_BACKGROUND, true);
    $userdata.set(K.RETURN_BG_TOP_COLOR, "#123456");
    const w = montar();
    enviar(slide("Aleluia"), null);
    await nextTick();

    const painel = w.find(".return-current").attributes("style") ?? "";
    expect(painel).toMatch(/#123456|rgb\(18, 52, 86\)/);
    expect(w.html()).not.toContain("capa-do-album");
  });

  it("o teto da letra é o configurado, sem o limite fixo de 160px", async () => {
    // Em 4K, 16vh são ~345px. O clamp(24px, Nvh, 160px) antigo derrubava tudo
    // acima de 160px, e a tela de Opções prometia um tamanho que não saía.
    Object.defineProperty(window, "innerHeight", { value: 2160, configurable: true });
    const w = montar();
    enviar(slide("Aleluia!<br>Aleluia!"), null);
    await nextTick();

    const px = parseFloat((w.find(".return-text").element as HTMLElement).style.fontSize);
    expect(px).toBeCloseTo((SLIDE_STYLE_DEFAULT.return_font_size_lyric * 2160) / 100, 0);
    expect(px).toBeGreaterThan(160);
  });

  it("o tamanho escolhido nas Opções é o teto, e a capa usa o dela", async () => {
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    $userdata.set(K.CUSTOM_RETURN_TEXT_FORMAT, true);
    $userdata.set(K.RETURN_FONT_SIZE_LYRIC, 8);
    $userdata.set(K.RETURN_FONT_SIZE_COVER, 12);
    const w = montar();

    enviar(slide("Aleluia"), null, 3);
    await nextTick();
    const letra = w.find(".return-text").element as HTMLElement;
    expect(parseFloat(letra.style.fontSize)).toBeCloseTo(80, 0);

    enviar(slide("Hino 1", { cover: true }), null, 0);
    await nextTick();
    const capa = w.find(".return-text").element as HTMLElement;
    expect(parseFloat(capa.style.fontSize)).toBeCloseTo(120, 0);
  });

  it("o próximo slide mostra a letra inteira e fica sem tamanho fixo no estilo do Vue", async () => {
    const w = montar();
    const proximo = slide("Linha um<br>Linha dois<br>Linha três<br>Linha quatro<br>Linha cinco");
    enviar(slide("Aleluia"), proximo);
    await nextTick();

    const html = w.find(".return-next-content").html();
    for (const linha of ["um", "dois", "três", "quatro", "cinco"]) expect(html).toContain(linha);
    // O tamanho é escrito pelo ajuste no elemento; o estilo do Vue não o disputa.
    const estilo = w.find(".return-next-content").attributes("style") ?? "";
    expect(estilo).not.toMatch(/-webkit-line-clamp/);
  });

  it("mostra o contador só quando há música aberta", async () => {
    const w = montar();
    expect(w.find(".return-counter").exists()).toBe(false);

    enviar(slide("Aleluia"), null, 3, 12);
    await nextTick();
    expect(w.find(".return-counter").text()).toBe("4 / 12");
  });

  it("o título tem a própria faixa e não fica sobre a letra", async () => {
    const w = montar();
    enviar(slide("Aleluia"), null);
    await nextTick();

    // Antes o título era absoluto sobre o palco e a primeira linha de uma
    // estrofe comprida passava por baixo dele.
    const cabeca = w.find(".return-head");
    const palco = w.find(".return-stage");
    expect(cabeca.find(".return-title").exists()).toBe(true);
    expect(cabeca.element.contains(palco.element)).toBe(false);
    expect(palco.element.contains(cabeca.element)).toBe(false);
  });
});
