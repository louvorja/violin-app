import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const h = vi.hoisted(() => ({
  listeners: new Map<string, ((_payload: unknown) => unknown)[]>(),
  load: vi.fn(),
}));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, fn: (_payload: unknown) => unknown) => {
    h.listeners.set(type, [...(h.listeners.get(type) ?? []), fn]);
  },
}));
vi.mock("@/helpers/Broadcast", () => ({ default: { send: vi.fn(), listen: () => () => {} } }));
vi.mock("@/composables/useProjectionCloseNotice", () => ({ useProjectionCloseNotice: vi.fn() }));
vi.mock("@/helpers/PdfRuntime", () => ({ loadPdfDocument: h.load }));
vi.mock("@/helpers/Http", () => ({
  NET_TIMEOUT: { MEDIA: 1 },
  fetchWithTimeout: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
}));
vi.mock("@/helpers/SettingsStorage", () => ({ getSetting: async () => null }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn(), setRuntimeContext: vi.fn() },
}));
vi.mock("@/views/LibrasOverlay.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/OverlayRenderer.vue", () => ({ default: { template: "<div />" } }));

import FileProjection from "@/views/FileProjection.vue";
import FileProjectionReturn from "@/views/FileProjectionReturn.vue";
import BackgroundProjection from "@/views/BackgroundProjection.vue";
import BackgroundProjectionReturn from "@/views/BackgroundProjectionReturn.vue";

async function emit(type: string, payload: unknown) {
  await Promise.all((h.listeners.get(type) ?? []).map((fn) => fn(payload)));
  await flushPromises();
}
const activation = (epoch: number) => ({
  stage_epoch: epoch,
  playback_id: `pdf-${epoch}`,
  type: "pdf",
  url: `https://test/${epoch}.pdf`,
  title: "PDF",
});

describe.each([
  ["projeção", FileProjection],
  ["retorno", FileProjectionReturn],
  ["fundo", BackgroundProjection],
  ["retorno de fundo", BackgroundProjectionReturn],
] as const)("PDF — %s", (_name, Component) => {
  let wrapper: VueWrapper | null;
  beforeEach(() => {
    h.listeners.clear();
    h.load.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    wrapper = mount(Component, {
      global: {
        plugins: [createPinia(), createI18n({ legacy: false, locale: "pt", messages: { pt: {} } })],
      },
    });
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function document() {
    return {
      numPages: 1,
      loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) },
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    };
  }

  it.each(["fechar", "desmontar"])(
    "libera um PDF que terminou de carregar depois de %s",
    async (action) => {
      const doc = document();
      let finish!: (_doc: typeof doc) => void;
      h.load.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      await emit(BROADCAST_TYPE.FILE_PROJECTION, activation(1));
      expect(h.load).toHaveBeenCalledOnce();
      if (action === "fechar") await emit(BROADCAST_TYPE.MEDIA_CLOSE, {});
      else {
        wrapper!.unmount();
        wrapper = null;
      }
      finish(doc);
      await flushPromises();
      expect(doc.loadingTask.destroy).toHaveBeenCalledOnce();
      expect(doc.getPage).not.toHaveBeenCalled();
    }
  );

  it("libera os recursos ao substituir o PDF e ao fechar a projeção", async () => {
    const first = document();
    const second = document();
    h.load.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await emit(BROADCAST_TYPE.FILE_PROJECTION, activation(1));
    await emit(BROADCAST_TYPE.FILE_PROJECTION, activation(2));
    expect(first.loadingTask.destroy).toHaveBeenCalledOnce();
    await emit(BROADCAST_TYPE.MEDIA_CLOSE, {});
    expect(second.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("o encerramento lento do PDF anterior não apaga a nova projeção", async () => {
    const first = document();
    const second = document();
    let finish!: () => void;
    first.loadingTask.destroy.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    h.load.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await emit(BROADCAST_TYPE.FILE_PROJECTION, activation(1));
    // A notificação de fechar não espera o worker: a ativação seguinte pode chegar já.
    for (const fn of h.listeners.get(BROADCAST_TYPE.MEDIA_CLOSE) ?? []) void fn({});
    await emit(BROADCAST_TYPE.FILE_PROJECTION, activation(2));
    finish();
    await flushPromises();
    await emit(BROADCAST_TYPE.MEDIA_CLOSE, {});
    expect(second.loadingTask.destroy).toHaveBeenCalledOnce();
  });
});
