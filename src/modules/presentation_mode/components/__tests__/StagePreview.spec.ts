import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";

const { isDownloaded } = vi.hoisted(() => ({ isDownloaded: vi.fn() }));

vi.mock("@/helpers/OnlineVideo", () => ({
  isDownloaded,
  youtubeEmbedUrl: (id: string) =>
    `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&controls=0`,
}));
vi.mock("@/helpers/Database", () => ({ default: { get: vi.fn(async () => null) } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { captureException: vi.fn() } }));
vi.mock("@/composables/useMedia", () => ({ buildSlidesFrom: vi.fn(() => []) }));
vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    t: (key: string) => key,
    tm: (key: string) => key,
  }),
}));
vi.mock("@/modules/presentation_mode/composables/useOutputs", () => ({
  useHasStageMonitor: () => ({ value: false }),
}));

import StagePreview from "../StagePreview.vue";

const view = {
  kind: "online" as const,
  title: "Vídeo do culto",
  icon: "youtube",
  playable: true,
  videoId: "abc12345678",
};

function mount() {
  return shallowMount(StagePreview, {
    props: { view },
    global: {
      stubs: {
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjIcon: true,
        LjMenu: { template: "<div><slot name=\"trigger\" /><slot /></div>" },
        SlideGrid: true,
      },
    },
  });
}

describe("prévia do vídeo on-line", () => {
  beforeEach(() => {
    isDownloaded.mockReset();
  });

  it("executa o arquivo quando o vídeo já foi baixado", async () => {
    isDownloaded.mockResolvedValue(true);
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.find("video").attributes("src")).toBe(
      "louvorja://onlinevideo/abc12345678.mp4"
    );
    expect(wrapper.find("iframe").exists()).toBe(false);
  });

  it("sem download, abre o player embutido do YouTube", async () => {
    isDownloaded.mockResolvedValue(false);
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.find("video").exists()).toBe(false);
    expect(wrapper.find("iframe").attributes("src")).toContain("/embed/abc12345678");
  });

  it("mantém o player embutido quando a checagem do disco falha", async () => {
    isDownloaded.mockRejectedValue(new Error("offline"));
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.find("iframe").exists()).toBe(true);
  });
});
