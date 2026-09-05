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
                     K.CUSTOM_RETURN_TEXT_FORMAT, K.RETURN_TEXT_CASE, K.SLIDES]) {
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

  it("lê o tamanho do próximo slide da chave que a tela grava", () => {
    $userdata.set(K.FONT_SIZE_NEXT, 12);
    expect(useSlideStyle().cfg.value.font_size_next).toBe(12);
    $userdata.set(K.FONT_SIZE_NEXT, undefined);
    expect(useSlideStyle().cfg.value.font_size_next).toBe(SLIDE_STYLE_DEFAULT.font_size_next);
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
