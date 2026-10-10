import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

/**
 * Pausa automática do som de fundo.
 *
 * O bug que motivou este spec: os quatro gatilhos viviam no `Index.vue` do
 * módulo. `useBroadcastListener` pausa o listener no `onDeactivated` e o módulo
 * vai para a faixa KeepAlive de consultas (`moduleCacheMax: 4`), então ao
 * trocar de aba — que é exatamente o que o operador faz para abrir a
 * Biblioteca — FILE_PROJECTION e ONLINE_VIDEO_PROJECTION deixavam de chegar.
 * E `autoPause` era lido de um cache local do Index, nunca atualizado pela
 * ribbon que é onde o operador liga a opção.
 *
 * Aqui **nenhum componente é montado**: é o composable, sozinho, que ouve e
 * pausa. Se algum dia os gatilhos voltarem para uma tela, este teste falha.
 */
const h = vi.hoisted(() => ({
  /*
   * REATIVO de propósito: os `watch` do composable leem `get()` no próprio
   * getter, e um valor plano não gera dependência — o watcher nunca mais
   * reavaliaria e nenhum gatilho dispararia.
   */
  estado: null as { show: boolean; playing: boolean } | null,
  config: null as Record<string, unknown> | null,
  ouvintes: new Set<(_msg: { type: string }) => void>(),
}));

vi.mock("@/helpers/AppData", async () => {
  const { reactive } = await import("vue");
  const estado = reactive({ show: false, playing: false });
  h.estado = estado;
  return {
    default: {
      get: (key: string) => (key === "modules.media.show" ? estado.show : estado.playing),
      set: () => {},
    },
  };
});

vi.mock("@/helpers/Broadcast", () => ({
  default: {
    listen: (cb: (_msg: { type: string }) => void) => {
      h.ouvintes.add(cb);
      return () => h.ouvintes.delete(cb);
    },
    send: (type: string) => {
      for (const cb of h.ouvintes) cb({ type });
    },
    getLastPayload: () => undefined,
  },
}));

vi.mock("@/helpers/SettingsStorage", () => ({
  getSetting: async () => h.config,
  saveSetting: async () => {},
}));

import { useBackgroundSound } from "@/composables/useBackgroundSound";

let pausedSpy: ReturnType<typeof vi.spyOn> | null = null;
let pauseSpy: ReturnType<typeof vi.spyOn> | null = null;

function emitir(tipo: string): void {
  for (const cb of h.ouvintes) cb({ type: tipo });
}

/** Áudio "tocando": o jsdom nunca reproduz, então o estado é imposto. */
function tocando(): ReturnType<typeof useBackgroundSound> {
  const bg = useBackgroundSound();
  pausedSpy!.mockReturnValue(false); // `pause()` só age se não estiver pausado
  bg.isPlaying.value = true;
  return bg;
}

beforeEach(() => {
  /* Muta, NÃO substitui: o mock guarda o mesmo objeto reativo — trocar o
     referencial deixava o `watch` apontando para um objeto morto. */
  h.estado!.show = false;
  h.estado!.playing = false;
  h.config = null;

  const bg = useBackgroundSound();
  expect(h.estado).not.toBeNull();
  bg.autoPause.value = true;
  bg.fadeOutMs.value = 1; /* um passo → callback em30 ms */
  bg.isPlaying.value = false;
  bg.setVolume(50);

  pausedSpy = vi
    .spyOn(HTMLMediaElement.prototype, "paused", "get")
    .mockReturnValue(false);
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");
  vi.useFakeTimers();
});

afterEach(() => {
  pausedSpy?.mockRestore();
  pauseSpy?.mockRestore();
  vi.useRealTimers();
});

describe("auto-pausa — gatilhos", () => {
  it("música/áudio que começa pausa o som, pelo fader configurado", async () => {
    const bg = tocando();
    h.estado!.playing = true;
    await vi.advanceTimersByTimeAsync(120);

    expect(pauseSpy).toHaveBeenCalled();
    expect(bg.isPlaying.value).toBe(false);
  });

  it("a opção ligada é o que permite — desligada, nada acontece", async () => {
    const bg = tocando();
    bg.autoPause.value = false;
    h.estado!.playing = true;
    await vi.advanceTimersByTimeAsync(120);

    expect(pauseSpy).not.toHaveBeenCalled();
    expect(bg.isPlaying.value).toBe(true);
  });

  it("vídeo da biblioteca/liturgia (FILE_PROJECTION) pausa sem componente montado", async () => {
    const bg = tocando();

    emitir(BROADCAST_TYPE.FILE_PROJECTION);
    await vi.advanceTimersByTimeAsync(60);

    expect(pauseSpy).toHaveBeenCalled();
    expect(bg.isPlaying.value).toBe(false);
  });

  it("música (SLIDES_DATA) pausa — é o único sinal que o caminho de música publica", async () => {
    /*
     * `useMedia._launchProjection` nunca escreve `modules.media.is_playing`
     * (o áudio vai por `_loadAudioSrc`, não por `openAudio`) e o `show` só
     * muda de valor quando não estava ligado — sem este broadcast, tocar uma
     * música depois de um vídeo não pausava nada.
     */
    const bg = tocando();

    emitir(BROADCAST_TYPE.SLIDES_DATA);
    await vi.advanceTimersByTimeAsync(60);

    expect(pauseSpy).toHaveBeenCalled();
    expect(bg.isPlaying.value).toBe(false);
  });

  it("projeção de Site (liturgia ou Canva) pausa também", async () => {
    /* Abre janela externa: não escreve `modules.media.*` nem manda
       FILE_PROJECTION — o broadcast é o único sinal. */
    const bg = tocando();

    emitir(BROADCAST_TYPE.SITE_PROJECTION);
    await vi.advanceTimersByTimeAsync(60);

    expect(pauseSpy).toHaveBeenCalled();
    expect(bg.isPlaying.value).toBe(false);
  });

  it("vídeo online (ONLINE_VIDEO_PROJECTION) também", async () => {
    const bg = tocando();

    emitir(BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION);
    await vi.advanceTimersByTimeAsync(60);

    expect(pauseSpy).toHaveBeenCalled();
    expect(bg.isPlaying.value).toBe(false);
  });

  it("broadcast que não é mídia nova não pausa", async () => {
    tocando();

    emitir(BROADCAST_TYPE.MEDIA_CLOSE);
    await vi.advanceTimersByTimeAsync(60);

    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("sem áudio tocando, o gatilho é inofensivo", async () => {
    const bg = useBackgroundSound();
    bg.isPlaying.value = false;

    emitir(BROADCAST_TYPE.FILE_PROJECTION);
    await vi.advanceTimersByTimeAsync(60);

    expect(pauseSpy).not.toHaveBeenCalled();
    expect(bg.isPlaying.value).toBe(false);
  });
});

describe("auto-pausa — configuração persistida", () => {
  it("carregarConfig aplica o que o operador escolheu (e o fader junto)", async () => {
    h.config = {
      id: "background_sound",
      autoPause: false,
      fadeIn: 5000,
      fadeOut: 7000,
      repeat: true,
    };
    const bg = useBackgroundSound();

    await bg.carregarConfig();

    expect(bg.autoPause.value).toBe(false);
    expect(bg.fadeInMs.value).toBe(5000);
    expect(bg.fadeOutMs.value).toBe(7000);
    expect(bg.repeat.value).toBe(true);
  });
});
