import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount as mountComponent } from "@vue/test-utils";

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
vi.mock("@/components/OverlayRenderer.vue", () => ({
  default: {
    name: "OverlayRenderer",
    props: { embedded: Boolean, units: Object },
    template: '<div class="overlay-renderer-stub" :data-embedded="String(embedded)" />',
  },
}));

import StagePreview, { type PreviewView } from "../StagePreview.vue";

const view = {
  kind: "online" as const,
  title: "Vídeo do culto",
  icon: "youtube",
  playable: true,
  videoId: "abc12345678",
};

function mount(target: PreviewView = view) {
  return mountComponent(StagePreview, {
    props: { view: target },
    global: {
      stubs: {
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjIcon: true,
        LjMenu: { template: '<div><slot name="trigger" /><slot /></div>' },
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

    expect(wrapper.find("video").attributes("src")).toBe("louvorja://onlinevideo/abc12345678.mp4");
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

  it("mostra a camada de sobreposições no quadro 16:9", () => {
    const wrapper = mount({
      kind: "image",
      title: "Foto",
      icon: "image",
      playable: true,
      url: "/foto.jpg",
    });

    const layer = wrapper.find('[data-testid="pm-preview-overlay"]');
    expect(layer.exists()).toBe(true);
    expect(layer.find(".overlay-renderer-stub").attributes("data-embedded")).toBe("true");
  });

  it("não sobrepõe a grade de slides de uma música", () => {
    const wrapper = mount({
      kind: "song",
      title: "Música",
      icon: "music",
      playable: true,
      songId: 1,
    });

    expect(wrapper.find('[data-testid="pm-preview-overlay"]').exists()).toBe(false);
  });
});
