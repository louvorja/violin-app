import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import RemoteControl from "../RemoteControl.vue";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/helpers/ApiClient", () => ({
  isTokenInvalid: vi.fn(() => false),
  apiFetch,
  postApi: vi.fn(async () => ({ status: "ok" })),
}));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: vi.fn(),
}));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });

const semMusica = {
  status: "ok",
  supported: true,
  playing: false,
  slides: [],
  currentSlideIndex: 0,
  title: "",
  presentation_session: null,
};

const playerRefresh = vi.hoisted(() => vi.fn(async () => {}));
const stopwatchRefresh = vi.hoisted(() => vi.fn(async () => {}));

beforeEach(() => {
  playerRefresh.mockClear();
  stopwatchRefresh.mockClear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async () => ({ ok: true, json: async () => semMusica }));
});

afterEach(() => {});

describe("RemoteControl — atualizar Player/Cronômetro", () => {
  let wrapper: VueWrapper | null = null;

  function montar(): VueWrapper {
    wrapper = shallowMount(RemoteControl, {
      global: {
        plugins: [i18n],
        stubs: {
          RemotePlayer: {
            template: "<div />",
            methods: { refresh: playerRefresh },
          },
          RemoteStopwatch: {
            template: "<div />",
            methods: { refresh: stopwatchRefresh },
          },
        },
      },
    });
    return wrapper;
  }

  it("o botão de sincronizar chama o refresh da aba Player", async () => {
    const w = montar();
    await flushPromises();
    const state = (w.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;

    state.tab = "player";
    await nextTick();
    await nextTick();
    await (state.refreshState as () => Promise<void>)();

    expect(playerRefresh).toHaveBeenCalledTimes(1);
    expect(stopwatchRefresh).not.toHaveBeenCalled();
    w.unmount();
    wrapper = null;
  });

  it("o botão de sincronizar chama o refresh da aba Cronômetro", async () => {
    const w = montar();
    await flushPromises();
    const state = (w.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;

    state.tab = "stopwatch";
    await nextTick();
    await nextTick();
    await (state.refreshState as () => Promise<void>)();

    expect(stopwatchRefresh).toHaveBeenCalledTimes(1);
    expect(playerRefresh).not.toHaveBeenCalled();
    w.unmount();
    wrapper = null;
  });
});
