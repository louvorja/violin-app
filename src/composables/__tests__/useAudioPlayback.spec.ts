import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAudioPlayback } from "@/composables/useAudioPlayback";

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
});
