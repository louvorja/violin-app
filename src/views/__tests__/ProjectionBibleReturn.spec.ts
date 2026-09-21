import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import $userdata from "@/helpers/UserData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import ProjectionBibleReturn from "@/views/ProjectionBibleReturn.vue";

const P = "modules.bible";
const CHAVES = [
  "font_size",
  "font",
  "font_color",
  "reference_font_color",
  "horizontal_align",
  "vertical_align",
  "image",
  "image_opacity",
  "background_color",
  "text_shadow",
  "reference_only",
  "show_reference",
];

const i18n = createI18n({
  legacy: false,
  locale: "pt",
  messages: { pt: { shell: { proj_return_next: "PRÓX" } } },
});

function verso(extra: Record<string, unknown> = {}) {
  Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE, {
    text: "Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito",
    reference: "João 3:16 (ARA)",
    book: "João",
    chapter: 3,
    verses: [16],
    version: "ARA",
    next_text: "Porque Deus enviou o seu Filho ao mundo, não para que condenasse o mundo",
    next_reference: "João 3:17",
    active: true,
    ...extra,
  });
}

/**
 * O jsdom não calcula layout: caixa e texto medem zero e tudo "cabe". Serve
 * para o que não depende de medida — de onde vem o teto, que opções chegam ao
 * texto e o que é desenhado. O encolher de verdade é exercitado em
 * FitText.spec.ts e conferido no navegador com versículos reais.
 */
describe("ProjectionBibleReturn", () => {
  let wrapper: VueWrapper | null = null;
  const alturaOriginal = window.innerHeight;

  beforeEach(() => {
    setActivePinia(createPinia());
    for (const k of CHAVES) $userdata.set(`${P}.${k}`, undefined);
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    Object.defineProperty(window, "innerHeight", { value: alturaOriginal, configurable: true });
  });

  function montar() {
    wrapper = mount(ProjectionBibleReturn, {
      attachTo: document.body,
      global: { plugins: [i18n], stubs: { OverlayRenderer: true } },
    });
    return wrapper;
  }

  const letra = (w: VueWrapper) => w.find(".return-text").element as HTMLElement;

  it("o padrão da opção de tamanho vira um teto generoso, sem o limite de 70px", async () => {
    // Antes: clamp(24px, 11vh, 70px), que em qualquer tela deixava a letra em
    // 70px no máximo e ignorava a opção "Tamanho da fonte".
    const w = montar();
    verso();
    await nextTick();
    expect(parseFloat(letra(w).style.fontSize)).toBeCloseTo(150, 0);
  });

  it("o tamanho da formatação da Bíblia é o teto do retorno", async () => {
    $userdata.set(`${P}.font_size`, 20);
    const w = montar();
    verso();
    await nextTick();
    expect(parseFloat(letra(w).style.fontSize)).toBeCloseTo(200, 0);

    $userdata.set(`${P}.font_size`, 6);
    Broadcast.send(BROADCAST_TYPE.BIBLE_FORMAT_CHANGED, {});
    await nextTick();
    expect(parseFloat(letra(w).style.fontSize)).toBeCloseTo(60, 0);
  });

  it("não desenha a imagem configurada para a projeção", async () => {
    $userdata.set(`${P}.image`, "https://exemplo.test/fundo-da-biblia.jpg");
    $userdata.set(`${P}.image_opacity`, 100);
    const w = montar();
    verso();
    await nextTick();

    expect(w.find(".return-bg").exists()).toBe(false);
    expect(w.html()).not.toContain("fundo-da-biblia");
  });

  it("sem fonte escolhida usa a fonte de projeção global, e não uma fixa", async () => {
    // resolveFont(null, FALLBACK) devolvia "DINCondensedBold" e ignorava a fonte
    // de projeção das Opções; o padrão do manifesto é herdá-la.
    const w = montar();
    verso();
    await nextTick();
    expect(w.find(".return-text").attributes("style")).toContain("--lj-font-projection");

    $userdata.set(`${P}.font`, "ImpactRegular");
    Broadcast.send(BROADCAST_TYPE.BIBLE_FORMAT_CHANGED, {});
    await nextTick();
    expect(w.find(".return-text").attributes("style")).toContain("ImpactRegular");
  });

  it("a referência é dourada por padrão e segue a cor que o operador escolheu", async () => {
    const w = montar();
    verso();
    await nextTick();
    const dourado = /#efb400|rgb\(239, 180, 0\)/i;
    expect(w.find(".return-title").attributes("style")).toMatch(dourado);
    expect(w.find(".return-next-reference").attributes("style")).toMatch(dourado);

    $userdata.set(`${P}.reference_font_color`, "#00ff66");
    Broadcast.send(BROADCAST_TYPE.BIBLE_FORMAT_CHANGED, {});
    await nextTick();
    const verde = /#00ff66|rgb\(0, 255, 102\)/i;
    expect(w.find(".return-title").attributes("style")).toMatch(verde);
    expect(w.find(".return-next-reference").attributes("style")).toMatch(verde);
  });

  it("o padrão do manifesto gravado no store não conta como cor escolhida", async () => {
    // O manifesto grava #FB8C00 no store; sem distinguir, o retorno ficava com
    // a referência laranja no topo e dourada no rodapé.
    $userdata.set(`${P}.reference_font_color`, "#FB8C00");
    const w = montar();
    verso();
    await nextTick();
    expect(w.find(".return-title").attributes("style")).toMatch(/#efb400|rgb\(239, 180, 0\)/i);
  });

  it.each([
    ["start", "left"],
    ["left", "left"],
    ["center", "center"],
    ["end", "right"],
    ["right", "right"],
  ])("alinhamento horizontal %s vira text-align %s no versículo e no próximo", async (valor, css) => {
    $userdata.set(`${P}.horizontal_align`, valor);
    const w = montar();
    verso();
    await nextTick();
    expect(letra(w).style.textAlign).toBe(css);
    expect((w.find(".return-next-content").element as HTMLElement).style.textAlign).toBe(css);
  });

  it("o alinhamento vertical escolhido vai para a caixa do versículo", async () => {
    $userdata.set(`${P}.vertical_align`, "end");
    const w = montar();
    verso();
    await nextTick();
    expect(w.find(".return-stage").classes()).toContain("align-end");
  });

  it("'só a referência' mostra a referência como texto e esvazia o cabeçalho", async () => {
    $userdata.set(`${P}.reference_only`, true);
    const w = montar();
    verso();
    await nextTick();
    expect(w.find(".return-text").text()).toBe("João 3:16");
    expect(w.find(".return-title").exists()).toBe(false);
  });

  it("o próximo versículo aparece inteiro, com a referência ao lado", async () => {
    const w = montar();
    verso();
    await nextTick();
    expect(w.find(".return-next-content").text()).toContain("não para que condenasse o mundo");
    expect(w.find(".return-next-reference").text()).toBe("João 3:17");
  });

  it("o próximo versículo não é cortado com reticências nem em linha única", () => {
    // Era `white-space: nowrap` + `text-overflow: ellipsis` em fonte fixa de 2rem:
    // todo versículo passava do painel e terminava em "…". O teste é de fonte
    // porque o jsdom não calcula layout.
    const fonte = readFileSync("src/views/ProjectionBibleReturn.vue", "utf8");
    const css = fonte.slice(fonte.indexOf("<style"));
    const inicio = css.indexOf(".return-next-content {");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const bloco = css.slice(inicio, css.indexOf("}", inicio));
    expect(bloco).not.toMatch(/text-overflow/);
    expect(bloco).not.toMatch(/white-space:\s*nowrap/);
    // Só o uso real: o comentário do componente cita o clamp antigo de propósito.
    expect(fonte).not.toMatch(/fontSize:\s*[`'"]clamp\(/);
  });
});
