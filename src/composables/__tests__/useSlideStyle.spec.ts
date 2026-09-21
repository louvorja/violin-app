import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSlideStyle } from "@/composables/useSlideStyle";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { SLIDE_STYLE_DEFAULT } from "@/config/SlideStyle";

const K = KEYS.OPTIONS.SLIDE;

/**
 * Três defeitos que só apareciam projetados, e por isso ninguém via até o culto:
 * a sombra sobrevivia ao próprio interruptor, o zero escolhido pelo usuário
 * virava o valor padrão, e o caixa do retorno ignorava o gate da tela.
 */
describe("useSlideStyle — leitura das opções", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    for (const k of [K.CUSTOM_TEXT_FORMAT, K.SHADOW_ENABLED, K.SHADOW_BLUR,
                     K.SHADOW_OFFSET_Y, K.FONT_SIZE_NEXT,
                     K.CUSTOM_RETURN_TEXT_FORMAT, K.RETURN_TEXT_CASE, K.SLIDES,
                     K.RETURN_FONT_SIZE_LYRIC, K.RETURN_FONT_SIZE_COVER,
                     K.CUSTOM_RETURN_BACKGROUND, K.RETURN_BG_TOP_POSITION,
                     K.RETURN_BG_BOTTOM_POSITION]) {
      $userdata.set(k, undefined);
    }
  });

  it("desligar a formatação personalizada desliga a sombra", () => {
    $userdata.set(K.SHADOW_ENABLED, true);
    $userdata.set(K.CUSTOM_TEXT_FORMAT, false);
    expect(useSlideStyle().cfg.value.shadow_enabled).toBe(false);

    $userdata.set(K.CUSTOM_TEXT_FORMAT, true);
    expect(useSlideStyle().cfg.value.shadow_enabled).toBe(true);
  });

  it("o registro legado não reacende a sombra por baixo do gate", () => {
    // options.slide.slides é mesclado antes da leitura chave a chave; sem o
    // reset explícito, uma instalação antiga com a sombra ligada ali dentro
    // continuava sombreando com a formatação personalizada desligada.
    $userdata.set(K.SLIDES, { shadow_enabled: true });
    $userdata.set(K.CUSTOM_TEXT_FORMAT, false);
    expect(useSlideStyle().cfg.value.shadow_enabled).toBe(false);
  });

  it("preserva o zero escolhido em vez de trocá-lo pelo padrão", () => {
    $userdata.set(K.SHADOW_BLUR, 0);
    $userdata.set(K.SHADOW_OFFSET_Y, 0);
    const cfg = useSlideStyle().cfg.value;
    expect(cfg.shadow_blur).toBe(0);
    expect(cfg.shadow_offset_y).toBe(0);
  });

  it("limita valor fora de faixa e ignora lixo", () => {
    $userdata.set(K.SHADOW_BLUR, 999);
    expect(useSlideStyle().cfg.value.shadow_blur).toBe(30);
    $userdata.set(K.SHADOW_BLUR, "abc");
    expect(useSlideStyle().cfg.value.shadow_blur).toBe(12);
  });

  it("lê o tamanho do próximo slide só quando o retorno personalizado está ativo", () => {
    // Sem o gate ligado, font_size_next fica no padrão
    $userdata.set(K.FONT_SIZE_NEXT, 12);
    expect(useSlideStyle().cfg.value.font_size_next).toBe(SLIDE_STYLE_DEFAULT.font_size_next);

    // Com o gate ligado, lê o valor salvo
    $userdata.set(K.CUSTOM_RETURN_TEXT_FORMAT, true);
    expect(useSlideStyle().cfg.value.font_size_next).toBe(12);

    // Desligando o gate, reverte ao padrão
    $userdata.set(K.CUSTOM_RETURN_TEXT_FORMAT, false);
    expect(useSlideStyle().cfg.value.font_size_next).toBe(SLIDE_STYLE_DEFAULT.font_size_next);
  });

  it("o tamanho do próximo slide é o teto escolhido, sem limite escondido", () => {
    $userdata.set(K.CUSTOM_RETURN_TEXT_FORMAT, true);
    $userdata.set(K.FONT_SIZE_NEXT, 15);

    const ui = useSlideStyle();

    // O painel do retorno encolhe o texto para caber (useFitText) e lê o teto
    // daqui. Um `font-size` fixo no estilo, com cap em cqh, era o que fazia 15
    // valer 7,5 sem avisar e cortava o que passasse de duas linhas.
    expect(ui.cfg.value.font_size_next).toBe(15);
    expect(ui.nextStyle().fontSize).toBeUndefined();
  });

  it("a letra e a capa do retorno não fixam tamanho: o teto vem das opções", () => {
    // O padrão da letra é um teto generoso — letra curta enche o palco e a longa
    // encolhe para caber. Os tamanhos antigos (11 e 14) deixavam estrofes de duas
    // linhas pequenas e ainda cortavam as de cinco.
    const padrao = useSlideStyle().cfg.value;
    expect(padrao.return_font_size_lyric).toBe(SLIDE_STYLE_DEFAULT.return_font_size_lyric);
    expect(SLIDE_STYLE_DEFAULT.return_font_size_lyric).toBeGreaterThan(11);

    $userdata.set(K.CUSTOM_RETURN_TEXT_FORMAT, true);
    $userdata.set(K.RETURN_FONT_SIZE_LYRIC, 40);
    expect(useSlideStyle().cfg.value.return_font_size_lyric).toBe(40);
    // Acima do máximo da tela de Opções, a leitura limita em vez de aceitar lixo.
    $userdata.set(K.RETURN_FONT_SIZE_LYRIC, 999);
    expect(useSlideStyle().cfg.value.return_font_size_lyric).toBe(60);
  });

  it("guarda o modo de ajuste do fundo do retorno, sem achatá-lo em cover", () => {
    $userdata.set(K.CUSTOM_RETURN_BACKGROUND, true);
    for (const modo of ["cover", "contain", "center", "stretch", "tile"]) {
      $userdata.set(K.RETURN_BG_TOP_POSITION, modo);
      $userdata.set(K.RETURN_BG_BOTTOM_POSITION, modo);
      const cfg = useSlideStyle().cfg.value;
      expect(cfg.return_bg_top_position).toBe(modo);
      expect(cfg.return_bg_bottom_position).toBe(modo);
    }

    $userdata.set(K.RETURN_BG_TOP_POSITION, "lixo");
    expect(useSlideStyle().cfg.value.return_bg_top_position).toBe(
      SLIDE_STYLE_DEFAULT.return_bg_top_position
    );
  });

  it("o fundo do retorno usa o mesmo mapa de ajuste das demais telas", () => {
    $userdata.set(K.CUSTOM_RETURN_BACKGROUND, true);
    $userdata.set(K.RETURN_BG_TOP_POSITION, "stretch");
    const top = useSlideStyle().returnTopBgStyle();
    // Sem imagem escolhida só a cor é pintada; nunca a capa do slide.
    expect(top.backgroundImage).toBeUndefined();
    expect(top.background).toBe(SLIDE_STYLE_DEFAULT.return_bg_top_color);
  });

  it("o caixa do retorno obedece ao próprio interruptor", () => {
    $userdata.set(K.RETURN_TEXT_CASE, "capitalize");
    $userdata.set(K.CUSTOM_RETURN_TEXT_FORMAT, false);
    expect(useSlideStyle().textTransform.value).toBe("uppercase");

    $userdata.set(K.CUSTOM_RETURN_TEXT_FORMAT, true);
    expect(useSlideStyle().textTransform.value).toBe("capitalize");
  });

  it('traduz o valor legado "normal", que não existe em CSS', () => {
    $userdata.set(K.CUSTOM_RETURN_TEXT_FORMAT, true);
    $userdata.set(K.RETURN_TEXT_CASE, "normal");
    expect(useSlideStyle().textTransform.value).toBe("none");
  });
});
