import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useViewport, type UseViewport } from "@/composables/useViewport";

function setWindowSize(w: number, h: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: h });
}

function fireResize(): void {
  window.dispatchEvent(new Event("resize"));
}

/**
 * Monta um consumidor de verdade: o composable conta assinaturas por
 * componente, então chamá-lo solto não exercitaria o `onUnmounted`.
 */
function mountConsumer() {
  let viewport!: UseViewport;
  const wrapper = mount(
    defineComponent({
      setup() {
        viewport = useViewport();
        return () => h("div");
      },
    })
  );
  return { wrapper, viewport };
}

/** Quantas vezes o listener global de resize foi ligado/desligado. */
function countResizeCalls(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter((call) => call[0] === "resize").length;
}

describe("useViewport", () => {
  beforeEach(() => {
    setWindowSize(1280, 800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mede a janela já na primeira assinatura", () => {
    const { wrapper, viewport } = mountConsumer();

    expect(viewport.width.value).toBe(1280);
    expect(viewport.height.value).toBe(800);

    wrapper.unmount();
  });

  it("acompanha o resize da janela", () => {
    const { wrapper, viewport } = mountConsumer();

    setWindowSize(640, 480);
    fireResize();

    expect(viewport.width.value).toBe(640);
    expect(viewport.height.value).toBe(480);

    wrapper.unmount();
  });

  it("solta o listener quando o último consumidor se desmonta", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { wrapper, viewport } = mountConsumer();

    wrapper.unmount();

    expect(countResizeCalls(remove)).toBe(1);

    // E de fato parou de ouvir: sem consumidor, o resize não mexe no estado.
    setWindowSize(320, 240);
    fireResize();
    expect(viewport.width.value).toBe(1280);
  });

  it("oito consumidores compartilham um único listener e o mesmo estado", () => {
    const add = vi.spyOn(window, "addEventListener");
    const consumers = Array.from({ length: 8 }, () => mountConsumer());

    expect(countResizeCalls(add)).toBe(1);

    const [primeiro, ...resto] = consumers;
    for (const outro of resto) {
      expect(outro.viewport.width).toBe(primeiro.viewport.width);
    }

    setWindowSize(900, 700);
    fireResize();
    expect(consumers.at(-1)!.viewport.width.value).toBe(900);

    for (const c of consumers) c.wrapper.unmount();
  });

  it("desmontar um consumidor não desliga os que ficaram", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const a = mountConsumer();
    const b = mountConsumer();

    a.wrapper.unmount();
    expect(countResizeCalls(remove)).toBe(0);

    setWindowSize(1024, 768);
    fireResize();
    expect(b.viewport.width.value).toBe(1024);

    b.wrapper.unmount();
    expect(countResizeCalls(remove)).toBe(1);
  });

  it("religa e remede quando um consumidor volta depois de todos saírem", () => {
    const a = mountConsumer();
    const b = mountConsumer();
    // Ordem cruzada de propósito: o contador não pode depender de quem saiu antes.
    a.wrapper.unmount();
    b.wrapper.unmount();

    // Janela redimensionada enquanto ninguém ouvia.
    setWindowSize(1600, 900);

    const c = mountConsumer();
    expect(c.viewport.width.value).toBe(1600);
    expect(c.viewport.height.value).toBe(900);

    setWindowSize(800, 600);
    fireResize();
    expect(c.viewport.width.value).toBe(800);

    c.wrapper.unmount();
  });

  it("não deixa o consumidor escrever no estado compartilhado", () => {
    const { wrapper, viewport } = mountConsumer();

    // @ts-expect-error o ref é somente leitura — a escrita é ignorada em runtime
    viewport.width.value = 1;
    expect(viewport.width.value).toBe(1280);

    wrapper.unmount();
  });
});

/**
 * A plataforma é lida uma vez, quando o módulo carrega — testá-la exige
 * reimportar o módulo com o ambiente já trocado.
 */
describe("useViewport — platform", () => {
  const win = window as unknown as Record<string, unknown>;

  async function importWith(userAgent: string, electron: boolean) {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: userAgent,
    });
    if (electron) win.louvorjaApi = { platform: "win32" };
    vi.resetModules();
    const mod = await import("@/composables/useViewport");
    return mod.useViewport().platform;
  }

  afterEach(() => {
    delete win.louvorjaApi;
    delete (window.navigator as unknown as Record<string, unknown>).userAgent;
    vi.resetModules();
  });

  it("navegador desktop não é android, ios nem electron", async () => {
    const platform = await importWith(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      false
    );

    expect(platform).toEqual({ android: false, ios: false, electron: false });
  });

  it("reconhece android e ios pelo user agent", async () => {
    const android = await importWith(
      "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
      false
    );
    expect(android.android).toBe(true);
    expect(android.ios).toBe(false);

    const ios = await importWith(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      false
    );
    expect(ios.ios).toBe(true);
    expect(ios.android).toBe(false);
  });

  it("electron vem do Platform, não do user agent", async () => {
    // User agent de Electron sem o preload: para o app, isso não é desktop.
    const semPreload = await importWith(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/41.0.0 Safari/537.36",
      false
    );
    expect(semPreload.electron).toBe(false);

    const comPreload = await importWith("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", true);
    expect(comPreload.electron).toBe(true);
  });
});
