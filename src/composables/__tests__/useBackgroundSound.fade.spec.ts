import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/helpers/AppData", () => ({
  default: { get: () => false, set: () => {} },
}));

import { useBackgroundSound } from "@/composables/useBackgroundSound";

/**
 * "Parar" e "Tocar/Pausar" com o fade configurado.
 *
 * O rodapé chamava `stop()` sem duração — corte seco, igual ao botão "Parar
 * imediatamente" ao lado. `stopWithFade` lê a duração do próprio player, que é
 * onde a ribbon grava o ajuste.
 *
 * O jsdom não toca áudio: `paused` é forçado para `false`, que é a condição
 * que o `stop` usa para decidir se há o que esmaecer.
 */
describe("useBackgroundSound — parar e alternar com fade", () => {
  let paused: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    paused = vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
  });

  afterEach(() => {
    useBackgroundSound().stop(0);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function tocando(): ReturnType<typeof useBackgroundSound> {
    const bg = useBackgroundSound();
    bg.playFile({ id: "s1", name: "Som", fileName: "som.mp3", path: "som.mp3" }, 0);
    return bg;
  }

  it("stopWithFade mantém a faixa até o fade configurado terminar", () => {
    const bg = tocando();
    bg.fadeOutMs.value = 2000;

    bg.stopWithFade();

    expect(bg.isPlaying.value).toBe(false);
    expect(bg.currentFile.value?.id).toBe("s1");

    vi.advanceTimersByTime(1500);
    expect(bg.currentFile.value?.id).toBe("s1");

    vi.advanceTimersByTime(600);
    expect(bg.currentFile.value).toBeNull();
  });

  it("stopWithFade segue o ajuste feito depois de a faixa começar", () => {
    const bg = tocando();
    bg.fadeOutMs.value = 5000;
    bg.fadeOutMs.value = 300;

    bg.stopWithFade();
    vi.advanceTimersByTime(400);

    expect(bg.currentFile.value).toBeNull();
  });

  it("stop(0) corta na hora", () => {
    const bg = tocando();
    bg.fadeOutMs.value = 2000;

    bg.stop(0);

    expect(bg.currentFile.value).toBeNull();
    expect(bg.isPlaying.value).toBe(false);
  });

  it("toggleWithFade pausa só depois do fade-out configurado", () => {
    const bg = tocando();
    bg.fadeOutMs.value = 900;
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();

    bg.toggleWithFade();

    expect(bg.isPlaying.value).toBe(false);
    vi.advanceTimersByTime(600);
    expect(pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(bg.currentFile.value?.id).toBe("s1");
    paused.mockReturnValue(true);
  });
});
