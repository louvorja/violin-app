import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import $userdata from "@/helpers/UserData";
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

const { useProjectionShutdown } = await import("@/composables/useProjectionShutdown");
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
    await vi.advanceTimersByTimeAsync(1000);

    expect($userdata.get(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING)).toBe(false);
  });

  it("mantém a projeção ligada quando a janela apenas recarregou", async () => {
    $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, true);
    janelasAbertas.add(PROJECTION_TYPE.BACKGROUND);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, {
      feature: PROJECTION_TYPE.BACKGROUND,
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect($userdata.get(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING)).toBe(true);
  });

  it("fechar o retorno não derruba a projeção principal", async () => {
    $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, true);
    janelasAbertas.add(PROJECTION_TYPE.BACKGROUND);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, {
      feature: PROJECTION_TYPE.BACKGROUND_RETURN,
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect($userdata.get(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING)).toBe(true);
  });

  it("desliga a projeção da bíblia quando a janela dela some", async () => {
    $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
    montarJanelaPrincipal();

    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, { feature: PROJECTION_TYPE.BIBLE });
    await vi.advanceTimersByTimeAsync(1000);

    expect($userdata.get(KEYS.MODULES.BIBLE.IS_PLAYING)).toBe(false);
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
  it("avisa no ESC, antes de a janela fechar", () => {
    const recebidos: unknown[] = [];
    const parar = Broadcast.listen((msg) => {
      if (msg.type === BROADCAST_TYPE.PROJECTION_CLOSED) recebidos.push(msg.payload);
    });

    mount(
      defineComponent({
        setup: () => {
          useProjectionCloseNotice(PROJECTION_TYPE.BACKGROUND);
          return () => null;
        },
      })
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    parar();

    expect(recebidos).toEqual([{ feature: PROJECTION_TYPE.BACKGROUND }]);
  });
});
