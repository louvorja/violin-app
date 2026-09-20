/**
 * useMedia.spec.ts — Estado do player que a janela de Mídia lê.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";

type Media = typeof import("@/composables/useMedia").default;
let media: Media;

beforeAll(async () => {
  setActivePinia(createPinia());
  media = (await import("@/composables/useMedia")).default;
});

beforeEach(() => {
  setActivePinia(createPinia());
});

const slideIndex = () => (media.config() as { slide_index?: number } | undefined)?.slide_index;

describe("Media.clearVariables — slide_index", () => {
  it("começa em 0 numa sessão virgem, e não indefinido (o contador mostrava NaN/N)", () => {
    expect(slideIndex()).toBeUndefined();

    media.clearVariables();

    expect(slideIndex()).toBe(0);
  });

  it("volta a 0 ao abrir outra música depois de navegar", () => {
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SLIDE_INDEX, 3);

    media.clearVariables();

    expect(slideIndex()).toBe(0);
  });
});
