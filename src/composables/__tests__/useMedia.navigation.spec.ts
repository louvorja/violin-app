/**
 * useMedia.navigation — quem responde às setas de avançar/retroceder.
 *
 * As setas são registradas UMA vez, em `main-shell.js`, e chegam em
 * `Media.nextSlide()/prevSlide()`. Quem responde depende do que está no telão, e
 * a ordem é o contrato: lista de módulo (Biblioteca) → PDF → deck de música.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";

const goNext = vi.fn();
const goPrev = vi.fn();

vi.mock("@/composables/useSlides", () => ({
  useSlides: () => ({ goNext, goPrev, goFirst: vi.fn(), goLast: vi.fn() }),
}));

const pedido = vi.fn();

vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: (tipo: string, payload?: unknown) => pedido(tipo, payload),
    listen: () => () => {},
    getLastPayload: () => null,
  },
}));

type Media = typeof import("@/composables/useMedia").default;
let media: Media;

beforeEach(async () => {
  setActivePinia(createPinia());
  media = (await import("@/composables/useMedia")).default;
  goNext.mockClear();
  goPrev.mockClear();
  pedido.mockClear();
  media.unregisterNavigationDelegate();
  localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
  $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, false);
});

describe("setas: o dono registrado responde", () => {
  it("com lista de módulo no ar, a seta anda a lista e não o deck", () => {
    /*
     * A Biblioteca toca por `projectFile`, não pelo deck: sem o dono registrado
     * a seta caía em `_slides.goNext()` e a tecla era engolida sem efeito.
     */
    const next = vi.fn();
    const prev = vi.fn();
    media.registerNavigationDelegate({ next, prev });

    media.nextSlide();
    media.prevSlide();

    expect(next).toHaveBeenCalledTimes(1);
    expect(prev).toHaveBeenCalledTimes(1);
    expect(goNext).not.toHaveBeenCalled();
    expect(goPrev).not.toHaveBeenCalled();
  });

  it("sem dono, a seta volta a ser do deck de música", () => {
    media.nextSlide();
    media.prevSlide();

    expect(goNext).toHaveBeenCalledTimes(1);
    expect(goPrev).toHaveBeenCalledTimes(1);
  });

  it("música no palco tem prioridade: quem chamou é quem assume", () => {
    /*
     * Item de Biblioteca e música tocando nunca coexistem — a Biblioteca
     * projeta com `stopExistingAudio: true` e `projectFile` zera `IS_PLAYING`.
     * Se a música assumiu o palco, é ela que responde; e a guarda ainda segura
     * o caso de um módulo esquecer de devolver as setas.
     */
    media.registerNavigationDelegate({ next: vi.fn(), prev: vi.fn() });
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);

    media.nextSlide();

    expect(goNext).toHaveBeenCalledTimes(1);
  });

  it("devolver o registro entrega as setas de volta ao PDF e ao deck", () => {
    media.registerNavigationDelegate({ next: vi.fn(), prev: vi.fn() });
    media.unregisterNavigationDelegate();

    media.nextSlide();

    expect(goNext).toHaveBeenCalledTimes(1);
  });
});
