import { describe, it, expect, beforeEach } from "vitest";
import { useSlides, type Slide } from "@/composables/useSlides";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const slides = useSlides();

// Mesma música em cantada e playback: os slides são os mesmos, as marcações não.
const SUNG = [0, 10, 20, 30];
const PLAYBACK = [0, 8, 19, 28];

function abrir(times: number[], playbackId?: string): void {
  const lista: Slide[] = times.map((_, i) => ({ lyric: `slide ${i}` }));
  slides.setSlides(lista, times, "Música", playbackId);
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

describe("useSlides e o pedido de troca de slide entre janelas", () => {
  function tiposEmitidos(acao: () => void): string[] {
    const tipos: string[] = [];
    const parar = $broadcast.listen((msg) => tipos.push(msg.type));
    tipos.length = 0;
    acao();
    parar();
    return tipos;
  }

  it("a janela dona dos slides atende o pedido", () => {
    slides.reset();
    abrir(SUNG);

    const tipos = tiposEmitidos(() =>
      $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index: 2 })
    );

    expect(slides.slideIndex.value).toBe(2);
    expect(tipos).toContain(BROADCAST_TYPE.SLIDE_CHANGE);
  });

  it("propaga o playback_id para correlacionar a projeção com o player", () => {
    slides.reset();
    abrir(SUNG, "p-slides");
    let change: unknown;
    const parar = $broadcast.listen((msg) => {
      if (msg.type === BROADCAST_TYPE.SLIDE_CHANGE) change = msg.payload;
    });

    slides.goToSlide(1);
    parar();

    expect(change).toEqual(expect.objectContaining({ playback_id: "p-slides" }));
  });

  it("propaga revisão crescente e tempo do comando sem expor o conteúdo no marcador", () => {
    slides.reset();
    abrir(SUNG, "p-slides");
    const changes: Record<string, unknown>[] = [];
    const parar = $broadcast.listen((msg) => {
      if (msg.type === BROADCAST_TYPE.SLIDE_CHANGE) {
        changes.push(msg.payload as Record<string, unknown>);
      }
    });
    changes.length = 0; // descarta replay do último estado cached
    const commandAt = Date.now() - 25;
    slides.goToSlide(1, commandAt);
    slides.goToSlide(2);
    parar();

    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual(expect.objectContaining({
      presentation_revision: expect.any(Number),
      _command_ts: commandAt,
      _ts: expect.any(Number),
    }));
    expect(changes[1].presentation_revision).toBe((changes[0].presentation_revision as number) + 1);
    expect(changes[1]._command_ts).toBeGreaterThanOrEqual(commandAt);
  });

  it("preserva o início do comando vindo de outra janela", () => {
    slides.reset();
    abrir(SUNG);
    let change: Record<string, unknown> | undefined;
    const parar = $broadcast.listen((msg) => {
      if (msg.type === BROADCAST_TYPE.SLIDE_CHANGE) {
        change = msg.payload as Record<string, unknown>;
      }
    });
    const commandAt = Date.now() - 42;
    $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index: 2, _command_ts: commandAt });
    parar();

    expect(change).toEqual(expect.objectContaining({ slide_index: 2, _command_ts: commandAt }));
  });

  it("a janela sem slides ignora o pedido em vez de transmitir um slide vazio", () => {
    slides.reset();

    const tipos = tiposEmitidos(() =>
      $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index: 3 })
    );

    expect(tipos).not.toContain(BROADCAST_TYPE.SLIDE_CHANGE);
  });
});
