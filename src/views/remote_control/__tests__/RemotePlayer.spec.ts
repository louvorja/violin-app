import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import RemotePlayer from "../RemotePlayer.vue";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/helpers/ApiClient", () => ({
  isTokenInvalid: vi.fn(() => false),
  apiFetch,
  postApi: vi.fn(),
}));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "pt",
  messages: {
    pt: {
      remote_control: {
        player: { source_file: "Arquivo", source_youtube: "YouTube" },
      },
    },
  },
});

const MEDIA = {
  active: true,
  playing: true,
  loading: false,
  minimized: false,
  source: "file",
  title: "Culto",
  subtitle: "Álbum",
  fileName: "video.mp4",
  position: 12,
  duration: 120,
  canPlay: false,
  canPause: true,
  canSeek: true,
  canPrevious: false,
  canNext: true,
  seq: 1,
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "ok", state: MEDIA }),
  }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RemotePlayer — refresh e aba ativa", () => {
  it("expõe refresh e só polla quando a aba está ativa", async () => {
    const wrapper = shallowMount(RemotePlayer, {
      props: { token: "tk", active: false },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    // o load de entrada roda mesmo com a aba ainda não ativa
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
    expect(apiFetch).toHaveBeenCalledTimes(2);

    await wrapper.setProps({ active: true });
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(apiFetch).toHaveBeenCalledTimes(4);

    // O label "Arquivo" vem antes do nome do arquivo.
    expect(wrapper.find(".rp-now__file").text()).toBe("Arquivo · video.mp4");

    // Botões de salto ±10s seguem canSeek como o slider.
    const steps = wrapper.findAll(".rp-steps > *");
    expect(steps[1].attributes("disabled")).toBe("false");
    expect(steps[2].attributes("disabled")).toBe("false");

    apiFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", state: { ...MEDIA, canSeek: false } }),
    }));
    await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
    await flushPromises();
    expect(steps[1].attributes("disabled")).toBe("true");
    expect(steps[2].attributes("disabled")).toBe("true");

    wrapper.unmount();
  });
});
