import { describe, it, expect } from "vitest";
import { useSlides, type Slide } from "@/composables/useSlides";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const slides = useSlides();

function abrirMusica(): void {
  const lista: Slide[] = [0, 1, 2, 3].map((i) => ({ lyric: `slide ${i}` }));
  slides.setSlides(lista, [0, 10, 20, 30], "Música");
}

function tiposEmitidos(acao: () => void): string[] {
  const tipos: string[] = [];
  const parar = $broadcast.listen((msg) => tipos.push(msg.type));
  tipos.length = 0;
  acao();
  parar();
  return tipos;
}

describe("useSlides e o pedido de troca de slide entre janelas", () => {
  it("a janela dona dos slides atende o pedido", () => {
    slides.reset();
    abrirMusica();

    const tipos = tiposEmitidos(() =>
      $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index: 2 })
    );

    expect(slides.slideIndex.value).toBe(2);
    expect(tipos).toContain(BROADCAST_TYPE.SLIDE_CHANGE);
  });

  it("a janela sem slides ignora o pedido em vez de transmitir um slide vazio", () => {
    slides.reset();

    const tipos = tiposEmitidos(() =>
      $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index: 3 })
    );

    expect(tipos).not.toContain(BROADCAST_TYPE.SLIDE_CHANGE);
  });
});
