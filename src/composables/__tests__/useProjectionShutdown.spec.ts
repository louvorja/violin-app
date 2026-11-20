import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import $userdata from "@/helpers/UserData";
import $appdata from "@/helpers/AppData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import { PROJECTION_TYPE } from "@/constants/Projection";

const janelasAbertas = new Set<string>();

vi.mock("@/helpers/Projection", () => ({
  isOpen: (feature: string) => Promise.resolve(janelasAbertas.has(feature)),
  close: (feature: string) => {
    janelasAbertas.delete(feature);
    return Promise.resolve();
  },
}));

const { useProjectionShutdown, closingOnPurpose } =
  await import("@/composables/useProjectionShutdown");
const { useProjectionCloseNotice } = await import("@/composables/useProjectionCloseNotice");

/**
 * O botão que liga a projeção mora na janela principal, e a janela de projeção
 * fechava sozinha no ESC sem avisar ninguém: o ícone continuava vermelho com o
 * projetor apagado. O aviso agora existe — falta ele não disparar no F5.
 */
describe("useProjectionShutdown", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    janelasAbertas.clear();
    // O localStorage do ambiente de teste é um objeto pelado, sem os métodos.
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => guardado.get(k) ?? null,
      setItem: (k: string, v: string) => void guardado.set(k, v),
      removeItem: (k: string) => void guardado.delete(k),
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function montarJanelaPrincipal() {
    return mount(
      defineComponent({
        setup: () => {
          useProjectionShutdown();
          return () => null;
        },
      })
    );
  }

  it("desliga a projeção de fundo quando a janela dela some", async () => {
    $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, true);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, {
      feature: PROJECTION_TYPE.BACKGROUND,
    });
    await vi.advanceTimersByTimeAsync(3000);

    expect($userdata.get(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING)).toBe(false);
  });

  it("mantém a projeção ligada quando a janela apenas recarregou", async () => {
    $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, true);
    janelasAbertas.add(PROJECTION_TYPE.BACKGROUND);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, {
      feature: PROJECTION_TYPE.BACKGROUND,
    });
    await vi.advanceTimersByTimeAsync(3000);

    expect($userdata.get(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING)).toBe(true);
  });

  it("fechada de propósito (tela principal desligada), o retorno segue com o mesmo conteúdo", async () => {
    // Relógio no passado: a marca de "de propósito" (alguns segundos) não vaza para os outros testes.
    vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
    $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
    janelasAbertas.add(PROJECTION_TYPE.BIBLE_RETURN);
    montarJanelaPrincipal();

    closingOnPurpose(PROJECTION_TYPE.BIBLE);
    // A janela avisa duas vezes ao fechar (beforeunload e pagehide).
    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, { feature: PROJECTION_TYPE.BIBLE });
    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, { feature: PROJECTION_TYPE.BIBLE });
    await vi.advanceTimersByTimeAsync(1000);

    expect($userdata.get(KEYS.MODULES.BIBLE.IS_PLAYING)).toBe(true);
    expect(janelasAbertas.has(PROJECTION_TYPE.BIBLE_RETURN)).toBe(true);
  });

  it("janela fora do registro que recarrega devagar volta a tempo e mantém o estado", async () => {
    const payload = JSON.stringify({ url: "data:image/svg+xml,x", type: "image" });
    localStorage.setItem(KEYS.PROJECTION.LJ_FILE_PROJECTION, payload);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, { feature: PROJECTION_TYPE.FILE });
    // Passa da conferência de 400 ms: a página recarregada ainda não montou.
    await vi.advanceTimersByTimeAsync(900);
    Broadcast.send(BROADCAST_TYPE.PROJECTION_OPENED, { feature: PROJECTION_TYPE.FILE });
    await vi.advanceTimersByTimeAsync(3000);

    expect(localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION)).toBe(payload);
  });

  it("aviso de outra janela voltando não segura o desligamento", async () => {
    $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, { feature: PROJECTION_TYPE.BIBLE });
    await vi.advanceTimersByTimeAsync(300);
    Broadcast.send(BROADCAST_TYPE.PROJECTION_OPENED, { feature: PROJECTION_TYPE.FILE });
    await vi.advanceTimersByTimeAsync(3000);

    expect($userdata.get(KEYS.MODULES.BIBLE.IS_PLAYING)).toBe(false);
  });

  it("ESC desliga logo, sem esperar a janela voltar", async () => {
    $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, {
      feature: PROJECTION_TYPE.BIBLE,
      definitive: true,
    });
    await vi.advanceTimersByTimeAsync(600);

    expect($userdata.get(KEYS.MODULES.BIBLE.IS_PLAYING)).toBe(false);
  });

  it("fechar o retorno não derruba a projeção principal", async () => {
    $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, true);
    janelasAbertas.add(PROJECTION_TYPE.BACKGROUND);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, {
      feature: PROJECTION_TYPE.BACKGROUND_RETURN,
    });
    await vi.advanceTimersByTimeAsync(3000);

    expect($userdata.get(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING)).toBe(true);
  });

  it("desliga a projeção da bíblia quando a janela dela some", async () => {
    $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, { feature: PROJECTION_TYPE.BIBLE });
    await vi.advanceTimersByTimeAsync(3000);

    expect($userdata.get(KEYS.MODULES.BIBLE.IS_PLAYING)).toBe(false);
  });

  it("preserva o vídeo e o payload quando só a janela de projeção é fechada", async () => {
    const payload = JSON.stringify({ url: "louvorja://local/video.mp4", type: "video" });
    localStorage.setItem(KEYS.PROJECTION.LJ_FILE_PROJECTION, payload);
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);
    $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, true);
    $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING, true);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, { feature: PROJECTION_TYPE.FILE });
    await vi.advanceTimersByTimeAsync(3000);

    expect(localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION)).toBe(payload);
    expect($userdata.get(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING)).toBe(false);
    expect(janelasAbertas.has(PROJECTION_TYPE.FILE_RETURN)).toBe(false);
  });
});

/**
 * A outra ponta: sem a chamada lá na view, o aviso nunca sai e o botão volta a
 * ficar preso — sem erro no console, só o ícone vermelho com o projetor apagado.
 */
describe("views que precisam avisar o fechamento", () => {
  const VIEWS: Record<string, string> = {
    "src/views/BackgroundProjection.vue": "PROJECTION_TYPE.BACKGROUND",
    "src/views/ProjectionBible.vue": "PROJECTION_TYPE.BIBLE",
    "src/views/FileProjection.vue": "PROJECTION_TYPE.FILE",
    "src/views/AnnouncementsProjection.vue": "PROJECTION_TYPE.ANNOUNCEMENTS",
  };

  for (const [arquivo, feature] of Object.entries(VIEWS)) {
    it(`${arquivo} avisa com ${feature}`, () => {
      const fonte = readFileSync(arquivo, "utf8");
      expect(fonte).toContain(`useProjectionCloseNotice(${feature})`);
    });
  }
});

describe("useProjectionCloseNotice", () => {
  function montarProjecao(feature: string) {
    return mount(
      defineComponent({
        setup: () => {
          useProjectionCloseNotice(feature);
          return () => null;
        },
      })
    );
  }

  function escutar() {
    const recebidos: Array<{ type: string; payload: unknown }> = [];
    const parar = Broadcast.listen((msg) => {
      if (
        msg.type === BROADCAST_TYPE.PROJECTION_CLOSED ||
        msg.type === BROADCAST_TYPE.PROJECTION_OPENED
      ) {
        recebidos.push({ type: msg.type, payload: msg.payload });
      }
    });
    return { recebidos, parar };
  }

  it("avisa no ESC, antes de a janela fechar, como fechamento definitivo", () => {
    const { recebidos, parar } = escutar();
    const janela = montarProjecao(PROJECTION_TYPE.BACKGROUND);
    recebidos.length = 0;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    parar();
    janela.unmount();

    expect(recebidos).toEqual([
      {
        type: BROADCAST_TYPE.PROJECTION_CLOSED,
        payload: { feature: PROJECTION_TYPE.BACKGROUND, definitive: true },
      },
    ]);
  });

  it("ao descarregar (X ou F5) avisa sem marcar como definitivo", () => {
    const { recebidos, parar } = escutar();
    const janela = montarProjecao(PROJECTION_TYPE.FILE);
    recebidos.length = 0;

    window.dispatchEvent(new Event("pagehide"));
    parar();
    janela.unmount();

    expect(recebidos).toEqual([
      { type: BROADCAST_TYPE.PROJECTION_CLOSED, payload: { feature: PROJECTION_TYPE.FILE } },
    ]);
  });

  it("ao montar avisa que a janela voltou", () => {
    const { recebidos, parar } = escutar();

    const janela = montarProjecao(PROJECTION_TYPE.FILE);
    parar();
    janela.unmount();

    expect(recebidos).toEqual([
      { type: BROADCAST_TYPE.PROJECTION_OPENED, payload: { feature: PROJECTION_TYPE.FILE } },
    ]);
  });
});
