import { describe, it, expect, beforeEach } from "vitest";
import { useSlides, type Slide } from "@/composables/useSlides";

const slides = useSlides();

// Mesma música em cantada e playback: os slides são os mesmos, as marcações não.
const SUNG = [0, 10, 20, 30];
const PLAYBACK = [0, 8, 19, 28];

function abrir(times: number[]): void {
  const lista: Slide[] = times.map((_, i) => ({ lyric: `slide ${i}` }));
  slides.setSlides(lista, times, "Música");
}

describe("useSlides.timeForPosition", () => {
  beforeEach(() => {
    slides.reset();
    abrir(SUNG);
  });

  it("leva o ponto do slide para a marcação equivalente da outra faixa", () => {
    slides.setTimes(PLAYBACK);

    expect(slides.timeForPosition(2, 0.5, 40)).toBe(23.5);
  });

  it("no último slide o fim da faixa faz as vezes da próxima marcação", () => {
    slides.setTimes(PLAYBACK);

    expect(slides.timeForPosition(3, 0.5, 40)).toBe(34);
  });

  it("sem duração conhecida no último slide, entra no início dele", () => {
    slides.setTimes(PLAYBACK);

    expect(slides.timeForPosition(3, 0.5, NaN)).toBe(28);
  });

  it("troca de marcações preserva o slide no ar", () => {
    slides.goToSlide(2);
    expect(slides.slideIndex.value).toBe(2);

    slides.setTimes(PLAYBACK);

    expect(slides.slideIndex.value).toBe(2);
    expect(slides.slides.value.length).toBe(4);
  });
});
