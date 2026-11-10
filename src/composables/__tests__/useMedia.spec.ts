/**
 * useMedia.spec.ts — Estado do player que a janela de Mídia lê.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
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

describe("Media — preparações externas", () => {
  it("invalida a guarda ao fechar ou iniciar outra projeção", async () => {
    const beforeClose = media.captureStageGuard();
    expect(beforeClose()).toBe(true);
    await media.close(true);
    expect(beforeClose()).toBe(false);
    const beforeProjection = media.captureStageGuard();
    const projection = media.projectFile({ url: "blob:new", type: "image", title: "Nova" });
    expect(beforeProjection()).toBe(false);
    await projection;
  });

  it("uma solicitação inválida não interrompe a preparação atual", async () => {
    const current = media.captureStageGuard();
    expect(await media.open(null as unknown as number)).toBe(false);
    expect(current()).toBe(true);
  });
});

describe("Media.toogleVolume — mudo", () => {
  const volume = () => $appdata.get(KEYS.MODULES.MEDIA.CONFIG.VOLUME);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("silencia direto de qualquer volume, sem passar por 100, e desfaz para o volume de antes", () => {
    media.setVolume(35);
    media.toogleVolume();
    expect(volume()).toBe(0);
    media.toogleVolume();
    expect(volume()).toBe(35);
  });

  it("depois de arrastar até o zero, desfazer volta ao volume de antes do arrasto, não a 1%", () => {
    vi.useFakeTimers();
    media.setVolume(60);
    vi.advanceTimersByTime(2000);
    for (let v = 59; v >= 0; v--) {
      media.setVolume(v);
      vi.advanceTimersByTime(16);
    }
    media.toogleVolume();
    expect(volume()).toBe(60);
  });

  it("silenciar logo depois de arrastar guarda o volume em que o arrasto parou", () => {
    vi.useFakeTimers();
    media.setVolume(35);
    vi.advanceTimersByTime(2000);
    for (let v = 36; v <= 70; v++) {
      media.setVolume(v);
      vi.advanceTimersByTime(16);
    }
    media.toogleVolume();
    expect(volume()).toBe(0);
    media.toogleVolume();
    expect(volume()).toBe(70);
  });
});
