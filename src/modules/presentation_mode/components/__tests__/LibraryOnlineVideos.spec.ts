import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

const mocks = vi.hoisted(() => ({
  catalogLoad: vi.fn(async () => {}),
  customLoad: vi.fn(async () => {}),
  addVideo: vi.fn(async (payload: { categoryId?: string; name?: string }) => ({
    ok: true as const,
    video: { id: "new-1", categoryId: payload.categoryId || undefined, name: payload.name || "Novo" },
  })),
  disposeThumbs: vi.fn(),
  openModule: vi.fn(),
  snackbarError: vi.fn(),
  refreshDownloads: vi.fn(async () => {}),
}));

const catalog = {
  channels: { value: [{ channel_id: "c1", title: "Canal A" }] },
  allVideos: {
    value: [
      { video_id: "v1", playlist_id: "p1", title: "Vídeo Um" },
      { video_id: "v2", playlist_id: "p1", title: "Vídeo Dois" },
    ],
  },
  loading: { value: false },
  loaded: { value: true },
  error: { value: false },
  channelById: { value: new Map([["c1", { channel_id: "c1", title: "Canal A" }]]) },
  playlistById: { value: new Map([["p1", { playlist_id: "p1", channel_id: "c1", title: "Playlist 1" }]]) },
  playlistsOfChannel: vi.fn(() => [{ playlist_id: "p1", channel_id: "c1", title: "Playlist 1" }]),
  videosOfChannel: vi.fn(() => [
    { video_id: "v1", playlist_id: "p1", title: "Vídeo Um" },
    { video_id: "v2", playlist_id: "p1", title: "Vídeo Dois" },
  ]),
  videosOfPlaylist: vi.fn(() => [
    { video_id: "v1", playlist_id: "p1", title: "Vídeo Um" },
    { video_id: "v2", playlist_id: "p1", title: "Vídeo Dois" },
  ]),
  firstVideoIdOfPlaylist: vi.fn(() => "v1"),
  playlistThumb: vi.fn(() => "playlist-thumb"),
  channelTitleOfVideo: vi.fn(() => "Canal A"),
  load: mocks.catalogLoad,
};

const customVideo = {
  id: "cv1",
  name: "Meu vídeo",
  url: "https://youtu.be/abcdefghijk",
  createdAt: "2026-01-01T00:00:00.000Z",
  categoryId: "cc1",
};
const categories = [{ id: "cc1", name: "Minha categoria", color: "#3a7" }];
const custom = {
  videos: { value: [customVideo] },
  categories: { value: categories },
  loading: { value: false },
  loaded: { value: true },
  error: { value: false },
  categoryOf: vi.fn((video: typeof customVideo) => categories.find((c) => c.id === video.categoryId) || null),
  videosOfCategory: vi.fn((categoryId: string) =>
    categoryId === "cc1" ? [customVideo] : []
  ),
  countOf: vi.fn((categoryId: string) => (categoryId === "cc1" ? 1 : 0)),
  hasUncategorized: { value: false },
  thumbOf: vi.fn(() => "custom-thumb"),
  categoryImageOf: vi.fn(() => ""),
  displayName: (video: { name: string }) => video.name,
  youtubeIdOf: (url: string) => url.match(/youtu\.be\/([\w-]{11})/)?.[1] || null,
  load: mocks.customLoad,
  addVideo: mocks.addVideo,
  disposeThumbs: mocks.disposeThumbs,
};

vi.mock("@/modules/presentation_mode/composables/useOnlineCatalog", () => ({
  useOnlineCatalog: () => catalog,
}));
vi.mock("@/modules/presentation_mode/composables/useCustomOnlineVideos", () => ({
  useCustomOnlineVideos: () => custom,
}));
vi.mock("@/composables/useOnlineVideoDownloads", () => ({
  useOnlineVideoDownloads: () => ({
    available: true,
    refresh: mocks.refreshDownloads,
  }),
}));
vi.mock("@/composables/useModuleI18n", () => ({
  useModuleI18n: () => ({
    t: (key: string) => key,
    tm: (key: string) => key,
    locale: ref("pt"),
  }),
}));
vi.mock("@/helpers/Modules", () => ({ default: { open: mocks.openModule } }));
vi.mock("@/helpers/Snackbar", () => ({
  default: { error: mocks.snackbarError },
}));
vi.mock("@/helpers/OnlineVideo", () => ({
  prepare: vi.fn(),
  fetchYoutubeTitle: vi.fn(async () => null),
  youtubeThumb: (id: string) => `thumb:${id}`,
}));

vi.mock("../CategoryListItem.vue", () => ({
  default: {
    name: "CategoryListItem",
    props: ["categoryId", "name", "count", "active", "icon", "iconType", "color"],
    emits: ["select"],
    template:
      '<button class="pm-cat-stub" v-bind="$attrs" :data-category-id="categoryId" :data-active="String(active)" @click="$emit(\'select\')">{{ name }}</button>',
  },
}));
vi.mock("@/modules/online_videos/components/OnlineVideoCard.vue", () => ({
  default: {
    name: "OnlineVideoCard",
    props: ["entity", "variant", "subtitle", "active", "firstVideoId", "layout"],
    emits: ["select", "playAll"],
    template:
      '<div class="ov-card-stub" :data-variant="variant" @click="$emit(\'select\')">{{ entity.title }}</div>',
  },
}));
vi.mock("../OnlineVideoAddDialog.vue", () => ({
  default: {
    name: "OnlineVideoAddDialog",
    props: ["modelValue", "categories", "defaultCategoryId", "saving"],
    emits: ["update:modelValue", "save"],
    template:
      '<div class="pm-add-stub" :data-open="String(modelValue)"><button class="pm-add-stub-save" @click="$emit(\'save\', { url: \'https://youtu.be/qqqqqqqqqqq\', name: \'Novo\', categoryId: \'cc1\' })"></button></div>',
  },
}));

import LibraryOnlineVideos from "../LibraryOnlineVideos.vue";

function mountPanel() {
  return mount(LibraryOnlineVideos, {
    props: { liveVideoId: null },
    global: {
      stubs: {
        LjInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        LjButton: { template: '<button v-bind="$attrs"><slot /></button>' },
        LjIcon: true,
      },
    },
  });
}

describe("LibraryOnlineVideos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tem a busca, o botão de adicionar e depois os dois grupos", () => {
    const wrapper = mountPanel();
    const side = wrapper.find(".pm-ovl__side").element as HTMLElement;
    expect(side.children[0]?.className).toContain("pm-ovl__search");
    expect(side.children[1]?.className).toContain("pm-ovl__add");
    expect(side.children[2]?.className).toContain("pm-ovl__groups");

    expect(wrapper.find('[data-testid="pm-ovl-all"]').attributes("data-active")).toBe("true");
    expect(wrapper.find('[data-testid="pm-ovl-channel-c1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pm-ovl-custom-all"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pm-ovl-uncategorized"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pm-ovl-category-cc1"]').exists()).toBe(true);
  });

  it("navega canal → playlist → vídeos e volta", async () => {
    const wrapper = mountPanel();
    await wrapper.find('[data-testid="pm-ovl-channel-c1"]').trigger("click");

    expect(wrapper.find('[data-testid="pm-ovl-playlist-p1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pm-ovl-grid"]').exists()).toBe(false);

    await wrapper.find('[data-testid="pm-ovl-playlist-p1"]').trigger("click");
    expect(wrapper.find('[data-testid="pm-ovl-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pm-ovl-card-v1"]').exists()).toBe(true);

    await wrapper.find('[data-testid="pm-ovl-back"]').trigger("click");
    expect(wrapper.find('[data-testid="pm-ovl-playlist-p1"]').exists()).toBe(true);

    await wrapper.find('[data-testid="pm-ovl-back"]').trigger("click");
    expect(wrapper.find('[data-testid="pm-ovl-all"]').attributes("data-active")).toBe("true");
  });

  it("filtra os vídeos pela busca", async () => {
    const wrapper = mountPanel();
    expect(wrapper.findAll(".ov-card-stub")).toHaveLength(2);

    await wrapper.find(".pm-ovl__search input").setValue("dois");
    expect(wrapper.findAll(".ov-card-stub")).toHaveLength(1);
    expect(wrapper.find('[data-testid="pm-ovl-card-v2"]').exists()).toBe(true);

    await wrapper.find(".pm-ovl__search input").setValue("não existe");
    expect(wrapper.find('[data-testid="pm-ovl-grid"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("library.online_no_results");
  });

  it("seleciona a categoria de Meus Vídeos e mostra os cards", async () => {
    const wrapper = mountPanel();
    await wrapper.find('[data-testid="pm-ovl-category-cc1"]').trigger("click");

    expect(wrapper.find('[data-testid="pm-ovl-card-abcdefghijk"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("library.online_my_videos");
  });

  it("mostra todos os meus vídeos pela opção Todos", async () => {
    const wrapper = mountPanel();
    await wrapper.find('[data-testid="pm-ovl-custom-all"]').trigger("click");

    expect(wrapper.find('[data-testid="pm-ovl-custom-all"]').attributes("data-active")).toBe(
      "true"
    );
    expect(wrapper.find('[data-testid="pm-ovl-card-abcdefghijk"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("library.online_all_my_videos");
  });

  it("emite prévia, play e adicionar do card", async () => {
    const wrapper = mountPanel();

    await wrapper.find('[data-testid="pm-ovl-card-v1"]').trigger("click");
    expect(wrapper.emitted("preview")?.[0]?.[0]).toMatchObject({
      type: "online",
      videoId: "v1",
    });

    await wrapper.find('[data-testid="pm-ovl-play-v1"]').trigger("click");
    expect(wrapper.emitted("play")?.[0]?.[0]).toMatchObject({ type: "online", videoId: "v1" });

    await wrapper.find('[data-testid="pm-ovl-add-v1"]').trigger("click");
    expect(wrapper.emitted("add")?.[0]?.[0]).toMatchObject({
      kind: "online_video",
      title: "Vídeo Um",
    });
  });

  it("abre o diálogo e adiciona um vídeo em Meus Vídeos", async () => {
    const wrapper = mountPanel();
    await wrapper.find('[data-testid="pm-ovl-add-video"]').trigger("click");
    expect(wrapper.find(".pm-add-stub").attributes("data-open")).toBe("true");

    await wrapper.find(".pm-add-stub-save").trigger("click");
    expect(mocks.addVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://youtu.be/qqqqqqqqqqq",
        name: "Novo",
        categoryId: "cc1",
      })
    );
    expect(wrapper.find(".pm-add-stub").attributes("data-open")).toBe("false");
    expect(wrapper.find('[data-testid="pm-ovl-category-cc1"]').attributes("data-active")).toBe(
      "true"
    );
  });

  it("abre o gerenciador do módulo correspondente", async () => {
    const wrapper = mountPanel();
    await wrapper.find('[data-testid="pm-ovl-manage"]').trigger("click");
    expect(mocks.openModule).toHaveBeenCalledWith("online_videos");

    await wrapper.find('[data-testid="pm-ovl-category-cc1"]').trigger("click");
    await wrapper.find('[data-testid="pm-ovl-manage"]').trigger("click");
    expect(mocks.openModule).toHaveBeenCalledWith("custom_online_videos");
  });
});
