/**
 * useMedia.spec.ts — Estado do player que a janela de Mídia lê.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import $appdata from "@/helpers/AppData";
import $alert from "@/helpers/Alert";
import { KEYS } from "@/constants/UserDataKeys";

type Media = typeof import("@/composables/useMedia").default;
let media: Media;

beforeAll(async () => {
  setActivePinia(createPinia());
  media = (await import("@/composables/useMedia")).default;
});

beforeEach(() => {
  setActivePinia(createPinia());
});

const slideIndex = () => (media.config() as { slide_index?: number } | undefined)?.slide_index;

describe("Media.clearVariables — slide_index", () => {
  it("começa em 0 numa sessão virgem, e não indefinido (o contador mostrava NaN/N)", () => {
    expect(slideIndex()).toBeUndefined();

    media.clearVariables();

    expect(slideIndex()).toBe(0);
  });

  it("volta a 0 ao abrir outra música depois de navegar", () => {
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.SLIDE_INDEX, 3);

    media.clearVariables();

    expect(slideIndex()).toBe(0);
  });
});

describe("Media — preparações externas", () => {
  it("invalida a guarda ao fechar ou iniciar outra projeção", async () => {
    const beforeClose = media.captureStageGuard();
    expect(beforeClose()).toBe(true);
    await media.close(true);
    expect(beforeClose()).toBe(false);
    const beforeProjection = media.captureStageGuard();
    const projection = media.projectFile({ url: "blob:new", type: "image", title: "Nova" });
    expect(beforeProjection()).toBe(false);
    await projection;
  });

  it("uma solicitação inválida não interrompe a preparação atual", async () => {
    const current = media.captureStageGuard();
    expect(await media.open(null as unknown as number)).toBe(false);
    expect(current()).toBe(true);
  });
});

describe("Media.toogleVolume — mudo", () => {
  const volume = () => $appdata.get(KEYS.MODULES.MEDIA.CONFIG.VOLUME);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("silencia direto de qualquer volume, sem passar por 100, e desfaz para o volume de antes", () => {
    media.setVolume(35);
    media.toogleVolume();
    expect(volume()).toBe(0);
    media.toogleVolume();
    expect(volume()).toBe(35);
  });

  it("depois de arrastar até o zero, desfazer volta ao volume de antes do arrasto, não a 1%", () => {
    vi.useFakeTimers();
    media.setVolume(60);
    vi.advanceTimersByTime(2000);
    for (let v = 59; v >= 0; v--) {
      media.setVolume(v);
      vi.advanceTimersByTime(16);
    }
    media.toogleVolume();
    expect(volume()).toBe(60);
  });

  it("silenciar logo depois de arrastar guarda o volume em que o arrasto parou", () => {
    vi.useFakeTimers();
    media.setVolume(35);
    vi.advanceTimersByTime(2000);
    for (let v = 36; v <= 70; v++) {
      media.setVolume(v);
      vi.advanceTimersByTime(16);
    }
    media.toogleVolume();
    expect(volume()).toBe(0);
    media.toogleVolume();
    expect(volume()).toBe(70);
  });
});

describe("Media.close — playlist (#54)", () => {
  afterEach(() => {
    media.unregisterPlaylistCloseHandler();
    vi.restoreAllMocks();
  });

  it("o pedido de fechar espera o Sim para encerrar a playlist; o Não a mantém", () => {
    const playlistClosed = vi.fn();
    media.registerPlaylistCloseHandler(playlistClosed);
    let answer: ((btn?: string) => void) | undefined;
    const yesno = vi
      .spyOn($alert, "yesno")
      .mockImplementation((_data, callback) => (answer = callback));

    media.close();
    expect(yesno).toHaveBeenCalledTimes(1);
    expect(playlistClosed).not.toHaveBeenCalled();
    answer?.("no");
    expect(playlistClosed).not.toHaveBeenCalled();

    media.close();
    answer?.("yes");
    expect(playlistClosed).toHaveBeenCalledTimes(1);
  });

  it("o fechamento direto (paleta, atalho, controle remoto, outro módulo) também encerra a playlist", () => {
    const playlistClosed = vi.fn();
    media.registerPlaylistCloseHandler(playlistClosed);
    media.close(true);
    expect(playlistClosed).toHaveBeenCalledTimes(1);
  });
});
