import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAudioPlayback } from "@/composables/useAudioPlayback";

vi.mock("@/helpers/Telemetry", () => ({
  default: {
    track: vi.fn(),
    log: vi.fn(),
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
    stubPlay(
      namedError("AbortError", "The play() request was interrupted by a call to pause().")
    );
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

    el.dispatchEvent(new Event("waiting"));
    el.dispatchEvent(new Event("playing"));

    expect(Telemetry.track).toHaveBeenCalledWith(
      "music_buffering_started",
      expect.objectContaining({ playback_id: "p-buffer", id_music: 42, trigger: "waiting" }),
    );
    expect(Telemetry.track).toHaveBeenCalledWith(
      "music_buffering_recovered",
      expect.objectContaining({ playback_id: "p-buffer" }),
    );
    expect(Telemetry.track).toHaveBeenCalledWith(
      "music_play_started",
      expect.objectContaining({ playback_id: "p-buffer" }),
    );
  });

  it("não promove a faixa nova quando play() rejeita durante a troca", async () => {
    const current = audio.getElement();
    current.setAttribute("src", "blob:atual");
    const next = document.createElement("audio");
    next.setAttribute("src", "blob:nova");
    next.play = vi.fn(() => Promise.reject(namedError("NotSupportedError", "codec"))) as unknown as HTMLMediaElement["play"];
    next.pause = vi.fn();

    await expect(audio.takeOver(next, () => 0, true)).rejects.toMatchObject({ name: "NotSupportedError" });
    expect(audio.getElement()).toBe(current);
    expect(next.play).toHaveBeenCalledOnce();
  });
});
