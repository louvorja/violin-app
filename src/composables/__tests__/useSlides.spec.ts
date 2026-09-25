import { describe, it, expect, beforeEach, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { AudioPlayback } from "@/composables/useAudioPlayback";
import Telemetry from "@/helpers/Telemetry";
import { MusicPresentationCore } from "@/presentation/MusicPresentationCore";
import { useSlides, type Slide } from "@/composables/useSlides";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const slides = useSlides();

// Mesma música em cantada e playback: os slides são os mesmos, as marcações não.
const SUNG = [0, 10, 20, 30];
const PLAYBACK = [0, 8, 19, 28];

describe("useSlides presentation snapshot", () => {
  beforeEach(() => slides.reset());

  it("tracks manual navigation, close and reopening in the canonical core", () => {
    abrir(SUNG);
    const first = slides.presentationSnapshot()!.sessionId;
    slides.goToSlide(2);
    expect(slides.presentationSnapshot()).toMatchObject({ slideIndex: 2, active: true });
    slides.reset();
    expect(slides.presentationSnapshot()).toMatchObject({ active: false, totalSlides: 0 });
    abrir(SUNG);
    expect(slides.presentationSnapshot()!.sessionId).not.toBe(first);
  });

  it("waits for audio seek to commit, then independently derives the same slide", async () => {
    abrir(SUNG);
    const audio = {
      currentTime: ref(0), duration: ref(40), progress: ref(0), seekTo: vi.fn(),
    };
    slides.bindAudio(audio as unknown as AudioPlayback);
    slides.goToSlide(2);
    expect(audio.seekTo).toHaveBeenCalledWith(20);
    expect(slides.presentationSnapshot()!.slideIndex).toBe(0);
    audio.currentTime.value = 20;
    await nextTick();
    expect(slides.presentationSnapshot()).toMatchObject({ slideIndex: 2 });
    slides.setTimes(PLAYBACK);
    slides.setPlaybackId("replacement-audio");
    audio.currentTime.value = 29;
    await nextTick();
    expect(slides.presentationSnapshot()).toMatchObject({ slideIndex: 3 });
    slides.reset();
  });

  it("retries a transient snapshot publication failure without retrying on every clock tick", async () => {
    abrir(SUNG);
    const audio = {
      currentTime: ref(0), duration: ref(40), progress: ref(0), seekTo: vi.fn(),
    };
    const originalSend = $broadcast.send.bind($broadcast);
    let now = Date.now();
    let failOnce = true;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const send = vi.spyOn($broadcast, "send").mockImplementation((type, payload) => {
      if (type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT && failOnce) {
        failOnce = false;
        throw new Error("transient transport failure");
      }
      return originalSend(type, payload);
    });
    try {
      slides.bindAudio(audio as unknown as AudioPlayback);
      audio.currentTime.value = 10;
      await nextTick();
      expect(slides.presentationSnapshot()?.slideIndex).toBe(1);
      expect(send.mock.calls.filter(([type]) => type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toHaveLength(1);

      now += 500;
      audio.currentTime.value = 11;
      await nextTick();
      expect(send.mock.calls.filter(([type]) => type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toHaveLength(1);

      now += 501;
      audio.currentTime.value = 12;
      await nextTick();
      expect(send.mock.calls.filter(([type]) => type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toHaveLength(2);
      expect(slides.presentationSnapshot()?.slideIndex).toBe(1);
    } finally {
      send.mockRestore();
      clock.mockRestore();
      slides.reset();
    }
  });

  it("retries a failed close packet twice without a per-tick loop or duplicate incident", async () => {
    abrir(SUNG);
    const originalSend = $broadcast.send.bind($broadcast);
    const track = vi.spyOn(Telemetry, "track").mockImplementation(() => {});
    const send = vi.spyOn($broadcast, "send").mockImplementation((type, payload) => {
      if (type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT) {
        return { crossWindow: false, remoteRelay: "not_required" };
      }
      return originalSend(type, payload);
    });
    vi.useFakeTimers();
    try {
      slides.reset();
      expect(send.mock.calls.filter(([type]) => type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(send.mock.calls.filter(([type]) => type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toHaveLength(3);
      expect(track.mock.calls.filter(([event]) => event === "presentation_snapshot_publish_failed"))
        .toEqual([["presentation_snapshot_publish_failed", { reason: "broadcast_channel_failed", phase: "close" }]]);
    } finally {
      send.mockRestore();
      track.mockRestore();
      vi.useRealTimers();
    }
  });

  it("retries a failed cross-window enqueue without waiting for another audio tick", async () => {
    abrir(SUNG);
    vi.useFakeTimers();
    const originalSend = $broadcast.send.bind($broadcast);
    const track = vi.spyOn(Telemetry, "track");
    let failOnce = true;
    const send = vi.spyOn($broadcast, "send").mockImplementation((type, payload) => {
      if (type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT && failOnce) {
        failOnce = false;
        return { crossWindow: false, remoteRelay: "sent" };
      }
      return originalSend(type, payload);
    });
    try {
      slides.goToSlide(1);
      expect(send.mock.calls.filter(([type]) => type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toHaveLength(1);
      expect(track.mock.calls.filter(([event]) => event === "presentation_snapshot_publish_failed"))
        .toEqual([["presentation_snapshot_publish_failed", { reason: "broadcast_channel_failed" }]]);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(send.mock.calls.filter(([type]) => type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)).toHaveLength(2);
      expect(track.mock.calls.filter(([event]) => event === "presentation_snapshot_publish_failed"))
        .toHaveLength(1);
    } finally {
      send.mockRestore();
      track.mockRestore();
      vi.useRealTimers();
      slides.reset();
    }
  });

  it("recovery broadcasts do not create new domain commits", () => {
    abrir(SUNG);
    slides.goToSlide(1);
    const snapshot = slides.presentationSnapshot();
    $broadcast.send(BROADCAST_TYPE.REQUEST_SLIDE_STATE);
    expect(slides.presentationSnapshot()).toBe(snapshot);
  });

  it("does not select a different slide when the canonical core fails", () => {
    abrir(SUNG);
    const dispatch = vi.spyOn(MusicPresentationCore.prototype, "dispatch").mockImplementation(() => {
      throw new Error("presentation core failure");
    });
    try {
      expect(() => slides.goToSlide(2)).not.toThrow();
      expect(slides.slideIndex.value).toBe(0);
      expect(slides.presentationSnapshot()).toBeNull();
    } finally {
      dispatch.mockRestore();
    }
  });
});

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
      $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, {
        index: 2, presentation_session: slides.presentationSnapshot()?.sessionId,
      })
    );

    expect(slides.slideIndex.value).toBe(2);
    expect(tipos).toContain(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT);
    expect(tipos).not.toContain(BROADCAST_TYPE.SLIDE_CHANGE);
  });

  it("propaga o playback_id para correlacionar a projeção com o player", () => {
    slides.reset();
    abrir(SUNG, "p-slides");
    let change: Record<string, unknown> | undefined;
    const parar = $broadcast.listen((msg) => {
      if (msg.type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT) change = msg.payload as Record<string, unknown>;
    });

    slides.goToSlide(1);
    parar();

    expect(change).toEqual(expect.objectContaining({ playbackId: "p-slides" }));
  });

  it("propaga revisão crescente e tempo do comando sem expor o conteúdo no marcador", () => {
    slides.reset();
    abrir(SUNG, "p-slides");
    const changes: Record<string, unknown>[] = [];
    const parar = $broadcast.listen((msg) => {
      if (msg.type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT) {
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
      selectionRevision: expect.any(Number),
      commandAt,
      commitAt: expect.any(Number),
      emittedAt: expect.any(Number),
    }));
    expect(changes[0].commitAt).toBeGreaterThanOrEqual(commandAt);
    expect(changes[0].commitAt).toBeLessThanOrEqual(changes[0].emittedAt as number);
    expect(changes[1].selectionRevision).toBe((changes[0].selectionRevision as number) + 1);
    expect(changes[1].commandAt).toBeGreaterThanOrEqual(commandAt);
  });

  it("não atribui commit novo a replay de recuperação", () => {
    slides.reset();
    abrir(SUNG);
    const changes: Record<string, unknown>[] = [];
    const parar = $broadcast.listen((msg) => {
      if (msg.type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT) changes.push(msg.payload as Record<string, unknown>);
    });
    changes.length = 0; // listener recebe o último estado cached imediatamente
    slides.goToSlide(1);
    $broadcast.send(BROADCAST_TYPE.REQUEST_SLIDE_STATE);
    parar();

    expect(changes).toHaveLength(2);
    expect(changes[0].commitAt).toEqual(expect.any(Number));
    expect(changes[1].commitAt).toBeUndefined();
  });

  it("preserva o início do comando vindo de outra janela", () => {
    slides.reset();
    abrir(SUNG);
    let change: Record<string, unknown> | undefined;
    const parar = $broadcast.listen((msg) => {
      if (msg.type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT) {
        change = msg.payload as Record<string, unknown>;
      }
    });
    const commandAt = Date.now() - 42;
    $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, {
      index: 2, presentation_session: slides.presentationSnapshot()?.sessionId, _command_ts: commandAt,
    });
    parar();

    expect(change).toEqual(expect.objectContaining({
      commandAt,
      snapshot: expect.objectContaining({ slideIndex: 2 }),
    }));
  });

  it("a janela sem slides ignora o pedido em vez de transmitir um slide vazio", () => {
    slides.reset();

    const tipos = tiposEmitidos(() =>
      $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index: 3 })
    );

    expect(tipos).not.toContain(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT);
  });

  it("ignores a late command from a previous music session", () => {
    slides.reset();
    abrir(SUNG);
    const previousSession = slides.presentationSnapshot()?.sessionId;
    abrir(SUNG);
    $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index: 2, presentation_session: previousSession });
    $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, { index: 2 });
    expect(slides.slideIndex.value).toBe(0);
    $broadcast.send(BROADCAST_TYPE.GO_TO_SLIDE, {
      index: 2, presentation_session: slides.presentationSnapshot()?.sessionId,
    });
    expect(slides.slideIndex.value).toBe(2);
  });
});
