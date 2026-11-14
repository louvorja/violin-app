import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAudioPlayback } from "@/composables/useAudioPlayback";

vi.mock("@/helpers/Telemetry", () => ({
  default: {
    track: vi.fn(),
    log: vi.fn(),
    histogram: vi.fn(),
    captureException: vi.fn(),
  },
}));
import Telemetry from "@/helpers/Telemetry";

const audio = useAudioPlayback();

function stubPlay(rejection: Error | null) {
  const el = audio.getElement();
  el.setAttribute("src", "blob:teste");
  el.play = vi.fn(() =>
    rejection ? Promise.reject(rejection) : Promise.resolve()
  ) as unknown as HTMLMediaElement["play"];
  return el;
}

function namedError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe("useAudioPlayback.play", () => {
  beforeEach(() => {
    audio.reset();
    vi.clearAllMocks();
    audio.getElement().removeAttribute("src");
  });

  it("silencia AbortError — interromper um play() pendente é esperado, não falha", async () => {
    stubPlay(namedError("AbortError", "The play() request was interrupted by a call to pause()."));
    const onError = vi.fn();

    audio.play(onError);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it("reporta falha real de carregamento", async () => {
    stubPlay(namedError("NotSupportedError", "no supported source was found"));
    const onError = vi.fn();

    audio.play(onError);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
  });

  it("não chama play() sem fonte anexada", () => {
    const el = stubPlay(null);
    el.removeAttribute("src");

    audio.play();

    expect(el.play).not.toHaveBeenCalled();
  });

  it("registra buffering e recuperação com o contexto da tentativa", () => {
    const el = audio.getElement();
    audio.setTelemetryContext({ playback_id: "p-buffer", id_music: 42, mode: "audio" });

    vi.useFakeTimers();
    el.dispatchEvent(new Event("waiting"));
    vi.advanceTimersByTime(1200);
    el.dispatchEvent(new Event("playing"));
    vi.useRealTimers();

    expect(Telemetry.track).toHaveBeenCalledWith(
      "music_buffering_started",
      expect.objectContaining({ playback_id: "p-buffer", id_music: 42, trigger: "waiting" })
    );
    expect(Telemetry.track).toHaveBeenCalledWith(
      "music_buffering_recovered",
      expect.objectContaining({ playback_id: "p-buffer" })
    );
    expect(Telemetry.track).toHaveBeenCalledWith(
      "music_play_started",
      expect.objectContaining({ playback_id: "p-buffer" })
    );
  });

  it("não promove a faixa nova quando play() rejeita durante a troca", async () => {
    const current = audio.getElement();
    current.setAttribute("src", "blob:atual");
    const next = document.createElement("audio");
    next.setAttribute("src", "blob:nova");
    next.play = vi.fn(() =>
      Promise.reject(namedError("NotSupportedError", "codec"))
    ) as unknown as HTMLMediaElement["play"];
    next.pause = vi.fn();

    await expect(audio.takeOver(next, () => 0, true)).rejects.toMatchObject({
      name: "NotSupportedError",
    });
    expect(audio.getElement()).toBe(current);
    expect(next.play).toHaveBeenCalledOnce();
  });

  it("classifica erro de decodificação do elemento de mídia", () => {
    const el = audio.getElement();
    audio.setTelemetryContext({ playback_id: "p-decode", id_music: 7, mode: "instrumental" });
    Object.defineProperty(el, "error", {
      configurable: true,
      value: { code: 3, message: "decode failed" },
    });

    el.dispatchEvent(new Event("error"));

    expect(Telemetry.track).toHaveBeenCalledWith(
      "music_playback_failed",
      expect.objectContaining({ playback_id: "p-decode", stage: "media_element", reason: "decode" })
    );
  });

  it("retains original format and safe media state when an opaque blob source cannot be played", async () => {
    const el = stubPlay(namedError("NotSupportedError", "unsupported"));
    audio.setTelemetryContext({
      playback_id: "p-unsupported",
      source_type: "http",
      original_source: { source_scheme: "https", file_ext: "mov", source_transport: "network" },
    });
    const onError = vi.fn();
    audio.play(onError);
    await Promise.resolve();
    await Promise.resolve();
    expect(Telemetry.log).toHaveBeenCalledWith(
      "error",
      "music play promise rejected",
      expect.objectContaining({
        playback_id: "p-unsupported",
        stage: "play_promise",
        source_scheme: "blob",
        original_source: { source_scheme: "https", file_ext: "mov", source_transport: "network" },
        ready_state: el.readyState,
        network_state: el.networkState,
        paused: el.paused,
        buffered_ranges: [],
        seekable_ranges: [],
      })
    );
    expect(onError).toHaveBeenCalledOnce();
  });

  it("retains the old playback identity when a pending play rejects after source replacement", async () => {
    const el = stubPlay(null);
    let reject!: (_error: Error) => void;
    el.play = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        })
    );
    audio.setTelemetryContext({
      playback_id: "old",
      original_source: { file_basename: "old.mov" },
    });
    audio.play();
    audio.setTelemetryContext({
      playback_id: "new",
      original_source: { file_basename: "new.mp4" },
    });
    el.setAttribute("src", "blob:new");
    reject(namedError("NotSupportedError", "unsupported"));
    await Promise.resolve();
    await Promise.resolve();
    const diagnostics = vi
      .mocked(Telemetry.log)
      .mock.calls.find(([, message]) => message === "music play promise rejected")?.[2];
    expect(diagnostics).toMatchObject({
      playback_id: "old",
      stale_context: true,
      snapshot_omitted: "source_replaced",
      original_source: { file_basename: "old.mov" },
    });
    expect(diagnostics).not.toHaveProperty("ready_state");
  });

  it("detecta quando o relógio do áudio fica travado durante a reprodução", async () => {
    vi.useFakeTimers();
    try {
      const el = stubPlay(null);
      Object.defineProperty(el, "paused", { configurable: true, value: false });
      audio.setTelemetryContext({ playback_id: "p-stalled", id_music: 99, mode: "audio" });

      audio.play();
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(6000);

      expect(Telemetry.track).toHaveBeenCalledWith(
        "music_playback_stalled",
        expect.objectContaining({ playback_id: "p-stalled", reason: "time_not_advancing" })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("amostra o relógio em 10 Hz em vez de recalcular o renderer a cada frame", async () => {
    vi.useFakeTimers();
    const onTime = vi.fn();
    const off = audio.onTimeUpdate(onTime);
    try {
      const el = stubPlay(null);
      Object.defineProperty(el, "paused", { configurable: true, value: false });
      Object.defineProperty(el, "duration", { configurable: true, value: 60 });
      Object.defineProperty(el, "currentTime", { configurable: true, writable: true, value: 1 });

      audio.play();
      await Promise.resolve();
      await Promise.resolve();

      // Uma amostra imediata e, depois, dez amostras por segundo.
      expect(onTime).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_000);
      expect(onTime.mock.calls.length).toBeGreaterThanOrEqual(10);
      expect(onTime.mock.calls.length).toBeLessThanOrEqual(12);
    } finally {
      off();
      audio.reset();
      vi.useRealTimers();
    }
  });
});

describe("useAudioPlayback.media element", () => {
  it("usa um elemento de vídeo oculto para arquivos de vídeo e volta ao áudio", () => {
    const video = audio.setElementKind("video");
    expect(video.tagName).toBe("VIDEO");
    expect(video.style.display).toBe("none");

    const audioElement = audio.setElementKind("audio");
    expect(audioElement.tagName).toBe("AUDIO");
    expect(audioElement).not.toBe(video);
  });
});

describe("useAudioPlayback lifecycle", () => {
  beforeEach(() => {
    audio.reset();
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });

  afterEach(() => {
    audio.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("preserva a URL emprestada da biblioteca ao alternar de faixa", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL { static revokeObjectURL = revokeObjectURL; });
    audio.setSrc("blob:library-sung");
    const instrumental = document.createElement("audio");
    instrumental.src = "blob:library-instrumental";

    await audio.takeOver(instrumental, () => 0, false);
    audio.setSrc("blob:library-sung");

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(audio.getElement().getAttribute("src")).toBe("blob:library-sung");
  });

  it("revoga a cópia criada pelo player ao parar, sem revogar a fonte da biblioteca", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL { static revokeObjectURL = revokeObjectURL; });
    audio.setSrc("blob:player-copy", false, true);
    audio.stop();
    audio.setSrc("blob:library");
    audio.stop();

    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:player-copy");
  });

  it.each(["stop", "reset", "cleanup"] as const)(
    "%s cancela o fade e seu callback antes de outra música assumir",
    (action) => {
      const el = audio.getElement();
      Object.defineProperty(el, "paused", { configurable: true, value: false });
      el.volume = 1;
      const pauseOldTrack = vi.fn();
      audio.fadeOut(pauseOldTrack);
      vi.advanceTimersByTime(40);

      audio[action]();
      audio.setSrc("blob:outra-musica");
      audio.setVolume(100);
      vi.advanceTimersByTime(500);

      expect(pauseOldTrack).not.toHaveBeenCalled();
      expect(audio.getElement().volume).toBe(1);
      expect(audio.isFading.value).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("fade-out interrompido avisa quem espera por ele, sem chamar o callback de fim", () => {
    const el = audio.getElement();
    Object.defineProperty(el, "paused", { configurable: true, value: false });
    el.volume = 1;
    const finished = vi.fn();
    const interrupted = vi.fn();
    audio.fadeOut(finished, interrupted);
    vi.advanceTimersByTime(40);

    audio.pause();
    vi.advanceTimersByTime(500);

    expect(interrupted).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
  });

  it("fade-out que chega ao fim não dispara o aviso de interrupção", () => {
    const el = audio.getElement();
    Object.defineProperty(el, "paused", { configurable: true, value: false });
    el.volume = 1;
    const finished = vi.fn();
    const interrupted = vi.fn();
    audio.fadeOut(finished, interrupted);
    vi.advanceTimersByTime(500);
    audio.stop();

    expect(finished).toHaveBeenCalledOnce();
    expect(interrupted).not.toHaveBeenCalled();
  });

  it("retomar durante o fade de pausa cancela a pausa antiga e termina o fade", () => {
    const el = audio.getElement();
    Object.defineProperty(el, "paused", { configurable: true, value: false });
    el.volume = 1;
    const pauseOldTrack = vi.fn();
    const resumed = vi.fn();
    audio.fadeOut(pauseOldTrack);
    vi.advanceTimersByTime(60);
    audio.fadeIn(100, resumed);
    vi.advanceTimersByTime(500);

    expect(pauseOldTrack).not.toHaveBeenCalled();
    expect(resumed).toHaveBeenCalledOnce();
    expect(el.volume).toBe(1);
    expect(audio.isFading.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("não promove uma faixa cujo play terminou depois de fechar e abrir outra música", async () => {
    const current = audio.getElement();
    const next = document.createElement("audio");
    next.src = "blob:playback-antigo";
    let started!: () => void;
    next.play = vi.fn(() => new Promise<void>((resolve) => { started = resolve; }));
    const result = audio.takeOver(next, () => 0, true).catch((error) => error);

    audio.stop();
    audio.reset();
    audio.setSrc("blob:nova-musica");
    started();
    const outcome = await result;

    expect(outcome).toMatchObject({ name: "AbortError" });
    expect(audio.getElement()).toBe(current);
    expect(current.getAttribute("src")).toBe("blob:nova-musica");
    expect(next.hasAttribute("src")).toBe(false);
    expect(next.isConnected).toBe(false);
  });

  it("mantém a pausa solicitada enquanto a nova faixa ainda esperava play()", async () => {
    const next = document.createElement("audio");
    next.src = "blob:playback";
    let paused = false;
    Object.defineProperty(next, "paused", { configurable: true, get: () => paused });
    next.pause = vi.fn(() => { paused = true; });
    let started!: () => void;
    next.play = vi.fn(() => new Promise<void>((resolve) => { started = resolve; }));
    const result = audio.takeOver(next, () => 0, true);
    audio.pause();
    started();
    await result;

    expect(audio.getElement()).toBe(next);
    expect(next.pause).toHaveBeenCalledOnce();
    expect(audio.isPaused.value).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 35])("preserva volume %s escolhido enquanto a troca aguarda play()", async (volume) => {
    const next = document.createElement("audio");
    next.src = "blob:playback";
    Object.defineProperty(next, "paused", { configurable: true, value: false });
    let started!: () => void;
    next.play = vi.fn(() => new Promise<void>((resolve) => { started = resolve; }));
    const result = audio.takeOver(next, () => 0, true);

    audio.setVolume(volume);
    // Vale antes de o navegador começar a tocar, sem um pico na faixa nova.
    expect(next.volume).toBe(volume / 100);
    started();
    await result;

    expect(audio.getElement()).toBe(next);
    expect(audio.volume.value).toBe(volume);
    expect(next.volume).toBe(volume / 100);
  });

  it.each([0, 35])("preserva volume %s escolhido durante fade de retomada", (volume) => {
    const el = audio.getElement();
    el.volume = 0;
    const resumed = vi.fn();
    audio.fadeIn(100, resumed);
    vi.advanceTimersByTime(60);

    audio.setVolume(volume);
    vi.advanceTimersByTime(500);

    expect(audio.volume.value).toBe(volume);
    expect(el.volume).toBe(volume / 100);
    expect(resumed).toHaveBeenCalledOnce();
    expect(audio.isFading.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ajustar volume durante fade de pausa mantém a pausa solicitada", () => {
    const el = audio.getElement();
    Object.defineProperty(el, "paused", { configurable: true, value: false });
    el.volume = 1;
    const paused = vi.fn();
    audio.fadeOut(paused);
    vi.advanceTimersByTime(40);
    audio.setVolume(35);
    vi.advanceTimersByTime(500);

    expect(paused).toHaveBeenCalledOnce();
    expect(audio.volume.value).toBe(35);
    expect(el.volume).toBe(0);
    expect(audio.isFading.value).toBe(false);
  });
});

describe("useAudioPlayback.prepare", () => {
  beforeEach(() => {
    audio.reset();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    { code: 3, name: "DecodeError", nativeName: "MEDIA_ERR_DECODE" },
    { code: 4, name: "NotSupportedError", nativeName: "MEDIA_ERR_SRC_NOT_SUPPORTED" },
  ])(
    "preserva $name quando descartar a fonte limpa o erro nativo",
    async ({ code, name, nativeName }) => {
      const el = document.createElement("audio");
      document.body.appendChild(el);
      const nativeError = {
        code,
        message: "failed at https://example.test/private/audio.mp3?token=secret",
      };
      let error: typeof nativeError | null = nativeError;
      Object.defineProperty(el, "error", { configurable: true, get: () => error });
      el.pause = vi.fn();
      el.load = vi.fn(() => {
        if (el.hasAttribute("src")) return;
        // Chromium clears MediaError on load(); no callback may read it after cleanup.
        nativeError.code = 0;
        nativeError.message = "discarded";
        error = null;
        el.dispatchEvent(new Event("abort"));
        el.dispatchEvent(new Event("error"));
        el.dispatchEvent(new Event("canplay"));
      });
      vi.spyOn(document, "createElement").mockReturnValueOnce(el);
      const onFailure = vi.fn();
      const baselineTimers = vi.getTimerCount();
      const result = audio
        .prepare("https://example.test/audio.mp3", false, 0, {
          playback_id: "prepare-failure",
          id_music: 42,
          mode: "instrumental",
        })
        .catch((failure: Error) => {
          onFailure(failure);
          return failure;
        });

      el.dispatchEvent(new Event("error"));
      const failure = await result;

      expect(failure).toMatchObject({
        name,
        message: "prepare: falha ao carregar áudio",
        cause: { code, name: nativeName, message: "failed at [source]" },
      });
      expect((failure as Error).cause).not.toBe(nativeError);
      expect(el.error).toBeNull();
      expect(el.hasAttribute("src")).toBe(false);
      expect(el.isConnected).toBe(false);
      expect(el.pause).toHaveBeenCalledOnce();
      expect(el.load).toHaveBeenCalledTimes(2);
      expect(Telemetry.track).toHaveBeenCalledWith(
        "music_playback_failed",
        expect.objectContaining({
          playback_id: "prepare-failure",
          id_music: 42,
          mode: "instrumental",
          media_error_code: code,
          media_error_name: nativeName,
          media_error_message: "failed at [source]",
        })
      );

      const telemetryCalls = vi.mocked(Telemetry.track).mock.calls.length;
      el.dispatchEvent(new Event("error"));
      el.dispatchEvent(new Event("canplay"));
      el.dispatchEvent(new Event("loadedmetadata"));
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();

      expect(onFailure).toHaveBeenCalledOnce();
      expect(Telemetry.track).toHaveBeenCalledTimes(telemetryCalls);
      expect(el.pause).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(baselineTimers);
    }
  );
});

it("buffering curto só registra recuperação e playing repetido não repete início", () => {
  audio.reset();
  vi.clearAllMocks();
  vi.useFakeTimers();
  const el = audio.getElement();
  audio.setTelemetryContext({ playback_id: "p-fast", mode: "audio" });
  el.dispatchEvent(new Event("playing"));
  el.dispatchEvent(new Event("playing"));
  el.dispatchEvent(new Event("waiting"));
  vi.advanceTimersByTime(150);
  el.dispatchEvent(new Event("playing"));
  el.dispatchEvent(new Event("playing"));
  expect(
    vi.mocked(Telemetry.track).mock.calls.filter(([event]) => event === "music_play_started")
  ).toHaveLength(1);
  expect(
    vi.mocked(Telemetry.track).mock.calls.filter(([event]) => event === "music_playback_resumed")
  ).toHaveLength(1);
  expect(Telemetry.track).not.toHaveBeenCalledWith("music_buffering_started", expect.anything());
  expect(Telemetry.histogram).toHaveBeenCalledWith("louvorja.music.buffering.duration", 150, {
    phase: "playback",
  });
  audio.reset();
  vi.useRealTimers();
});
