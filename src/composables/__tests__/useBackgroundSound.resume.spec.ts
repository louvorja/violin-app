import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * O composable arma os gatilhos do auto-pause na primeira chamada, e esses
 * gatilhos leem AppData (Pinia) — que não existe aqui. O mock isola o escopo
 * deste spec: estado do player, não o armador.
 */
vi.mock("@/helpers/AppData", () => ({
  default: { get: () => false, set: () => {} },
}));

import { useBackgroundSound } from "@/composables/useBackgroundSound";

/**
 * `resume()` do player de som de fundo.
 *
 * O estado tem que virar "tocando" de forma **síncrona** (padrão de
 * `playFile`/`togglePlay`): o remote lê o estado logo depois do POST de
 * resume — se `isPlaying` só virasse true dentro da promise do `play()`, o
 * GET de estado seguinte ainda leria "pausado" com o áudio já tocando e a
 * tela travava com cara de pausada.
 *
 * O jsdom não reproduz áudio: `play()` é substituído por spy e o `paused`
 * nativo segue `true` — por isso o estado de "pausado" é simulado escrevendo
 * no ref exposto, que é justamente o que o GET de estado lê.
 */
describe("useBackgroundSound.resume", () => {
  const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");

  function playerComSrc(): ReturnType<typeof useBackgroundSound> {
    const bg = useBackgroundSound();
    // O play do playFile é irrelevante aqui (o catch engole) — o que importa
    // é o src anexado, que é a pré-condição do guard do resume.
    playSpy.mockReset().mockRejectedValueOnce(new Error("jsdom não reproduz"));
    bg.playFile({ id: "s1", name: "Som", fileName: "som.mp3", path: "som.mp3" });
    bg.isPlaying.value = false; // estado "pausado" (jsdom nunca toca)
    return bg;
  }

  beforeEach(() => {
    playSpy.mockReset().mockRejectedValue(new Error("jsdom não reproduz"));
  });

  it("marca 'tocando' de forma síncrona (sem esperar a promise)", () => {
    const bg = playerComSrc();

    playSpy.mockReturnValue(undefined as unknown as Promise<void>); // sem promise
    bg.resume();

    expect(bg.isPlaying.value).toBe(true);
  });

  it("se o play() falhar, volta para 'pausado'", async () => {
    const bg = playerComSrc();

    playSpy.mockRejectedValueOnce(new Error("boom"));
    bg.resume();
    expect(bg.isPlaying.value).toBe(true); // intenção imediata

    await Promise.resolve();
    await Promise.resolve();

    expect(bg.isPlaying.value).toBe(false); // falhou → honesto de novo
  });

  it("sem src não faz nada (nem mexe no estado)", () => {
    const bg = useBackgroundSound();
    // `stop` chama detachMediaSource e zera o src — pré-condição do guard.
    bg.stop(0);
    playSpy.mockClear();
    bg.isPlaying.value = false;

    bg.resume();

    expect(bg.isPlaying.value).toBe(false);
    expect(playSpy).not.toHaveBeenCalled();
  });
});
