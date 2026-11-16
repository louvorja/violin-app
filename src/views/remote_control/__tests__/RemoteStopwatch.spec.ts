import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import RemoteStopwatch from "../RemoteStopwatch.vue";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/helpers/ApiClient", () => ({
  isTokenInvalid: vi.fn(() => false),
  apiFetch,
  postApi: vi.fn(),
}));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: vi.fn(),
}));

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });

const STOPWATCH = {
  running: true,
  mode: "countup",
  elapsed: 12,
  target: null,
  remaining: null,
  alert: "",
  overtime: true,
  showSeconds: true,
  warningSeconds: 60,
  laps: [],
  projecting: false,
  seq: 1,
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "ok", state: STOPWATCH }),
  }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RemoteStopwatch — refresh e aba ativa", () => {
  it("expõe refresh e só polla quando a aba está ativa", async () => {
    const wrapper = shallowMount(RemoteStopwatch, {
      props: { token: "tk", active: false },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
    expect(apiFetch).toHaveBeenCalledTimes(2);

    await wrapper.setProps({ active: true });
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(apiFetch).toHaveBeenCalledTimes(4);

    wrapper.unmount();
  });
});
