import { mount } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { DB_TABLE } from "@/constants/DbTables";

const draggingId = ref<string | null>(null);
const dropTargetId = ref<string | null>(null);
const playOnlineVideoSequence = vi.fn();
const idbPut = vi.fn(async () => {});
const snackbarShow = vi.fn();
const openYouTube = vi.fn(async () => true);

const savedVideos = [
  {
    id: "v1",
    name: "Louvor A",
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    createdAt: "2026-01-02T00:00:00Z",
    categoryId: "cat-1",
  },
  {
    id: "v2",
    name: "Louvor B",
    url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    createdAt: "2026-01-01T00:00:00Z",
    categoryId: "cat-2",
  },
];

const savedCategories = [
  { id: "cat-1", name: "Louvores", icon: "music", iconType: "icon", color: "#3498db" },
  { id: "cat-2", name: "Sermões", icon: "book", iconType: "icon", color: "#9b59b6" },
];

vi.mock("@/composables/useCategoryDrag", () => ({
  useCategoryDrag: () => ({
    draggingId,
    dropTargetId,
    touchGhost: ref(null),
    shouldSuppressClick: () => false,
    shouldSuppressCategoryClick: () => false,
    onCardDragStart: vi.fn(),
    onCardDragEnd: vi.fn(),
    onCategoryDragOver: vi.fn(),
    onCategoryDragLeave: vi.fn(),
    onCategoryDrop: vi.fn(),
    onCardTouchStart: vi.fn(),
  }),
}));

vi.mock("@/modules/musics/composables/usePlaylistPlayback", () => ({
  usePlaylistPlayback: () => ({
    currentSong: ref(null),
    playOnlineVideoSequence,
  }),
}));

vi.mock("@/composables/useOnlineVideoDownloads", () => ({
  useOnlineVideoDownloads: () => ({
    available: false,
    adopt: vi.fn(),
    remove: vi.fn(),
    stateOf: () => "none",
  }),
}));

vi.mock("@/helpers/OnlineVideo", () => ({
  fetchYoutubeTitle: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("@/helpers/Http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/Http")>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(async () => ({ ok: false })),
  };
});

vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: vi.fn(),
}));

vi.mock("@/composables/useMedia", () => ({
  default: { openYouTube, close: vi.fn() },
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: vi.fn(async (table: string) => {
      if (table === DB_TABLE.CUSTOM_ONLINE_VIDEOS) return savedVideos.map((v) => ({ ...v }));
      if (table === DB_TABLE.CUSTOM_ONLINE_VIDEOS_CATEGORIES)
        return savedCategories.map((c) => ({ ...c }));
      return [];
    }),
    get: vi.fn(async () => undefined),
    put: idbPut,
    del: vi.fn(),
  },
}));

vi.mock("@/helpers/Alert", () => ({
  default: { error: vi.fn(), confirm: vi.fn(async () => false) },
}));

vi.mock("@/helpers/Snackbar", () => ({
  default: { show: snackbarShow },
}));

const { default: Index } = await import("../Index.vue");

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

function mountView() {
  return mount(Index, {
    global: {
      stubs: {
        ModuleContainer: {
          template: '<div><slot name="header" /><slot /></div>',
          methods: {
            tm: (key: string) => key,
            t: (key: string) => key,
          },
        },
        OnlineVideoDownloadsBar: { template: "<div />" },
        OnlineVideoDownload: { template: "<div />" },
        OnlineVideoDownloadBadge: { template: "<div />" },
        CategoryDragGhost: { template: "<div />" },
        CategoryManagerDialog: { template: "<div />" },
        CategoryItemIcon: { template: "<div />" },
        CategoryChip: {
          props: ["categoryId", "name", "active", "count", "showPlay", "playLabel"],
          emits: ["select", "play", "add", "edit"],
          template:
            '<button class="stub-chip" :data-cat="categoryId" @click="$emit(\'select\')" @dblclick="$emit(\'play\')">{{ name }} ({{ count }})</button>',
        },
        LjMenu: {
          props: ["items"],
          template:
            '<div class="stub-menu"><slot name="trigger" /><button v-for="(item, idx) in items" :key="idx" class="stub-menu-item" :data-label="item.label" @click="item.action && item.action()">{{ item.label }}</button></div>',
        },
        LjButton: {
          props: ["disabled"],
          emits: ["click"],
          template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
        },
        LjCard: {
          emits: ["click"],
          template: '<div class="stub-card" @click="$emit(\'click\', $event)"><slot /></div>',
        },
        LjDialog: { template: "<div />" },
        LjEmpty: { template: "<div />" },
        LjField: { template: "<div />" },
        LjIcon: { template: "<span />" },
        LjInput: { template: "<input />" },
        LjSelect: { template: "<select />" },
      },
    },
  });
}

describe("custom_online_videos — categorias visíveis e Tocar Todas (#51, #67)", () => {
  beforeEach(() => {
    draggingId.value = null;
    dropTargetId.value = null;
    playOnlineVideoSequence.mockClear();
    idbPut.mockClear();
    snackbarShow.mockClear();
  });

  it("mantém chips de categoria fora da área rolável e destaca o cabeçalho ao arrastar (#51)", async () => {
    const wrapper = mountView();
    await flush();

    const chips = wrapper.find(".cv-chips");
    const scroll = wrapper.find(".cv-scroll");
    expect(chips.exists()).toBe(true);
    expect(scroll.exists()).toBe(true);
    expect(scroll.element.contains(chips.element)).toBe(false);
    expect(chips.classes()).not.toContain("cv-chips--dragging");

    draggingId.value = "v1";
    await flush();

    expect(wrapper.find(".cv-chips").classes()).toContain("cv-chips--dragging");
    expect(wrapper.find(".cv-chips-drag-hint").exists()).toBe(true);
  });

  it("permite mover vídeo para outra categoria pelo menu de três pontinhos (#51)", async () => {
    const wrapper = mountView();
    await flush();

    const targetItem = wrapper
      .findAll(".stub-menu-item")
      .find((el) => el.attributes("data-label") === "Sermões");
    expect(targetItem).toBeDefined();

    await targetItem!.trigger("click");
    await flush();

    expect(idbPut).toHaveBeenCalledWith(
      DB_TABLE.CUSTOM_ONLINE_VIDEOS,
      expect.objectContaining({ id: "v1", categoryId: "cat-2" })
    );
    expect(snackbarShow).toHaveBeenCalled();
  });

  it("reproduz todas filtradas por categoria ou geral e reproduz categoria direta (#67)", async () => {
    const wrapper = mountView();
    await flush();

    const playAllBtn = wrapper.find(".cv-chips-play-all");
    expect(playAllBtn.exists()).toBe(true);
    await playAllBtn.trigger("click");

    expect(playOnlineVideoSequence).toHaveBeenCalledWith(
      "title",
      expect.arrayContaining([
        expect.objectContaining({ itemKey: "v1", videoId: "aaaaaaaaaaa" }),
        expect.objectContaining({ itemKey: "v2", videoId: "bbbbbbbbbbb" }),
      ])
    );

    playOnlineVideoSequence.mockClear();
    // Desseleciona cat-2 para filtrar só cat-1 ("Louvores")
    await wrapper.find('.stub-chip[data-cat="cat-2"]').trigger("click");
    await flush();
    await wrapper.find(".cv-chips-play-all").trigger("click");

    expect(playOnlineVideoSequence).toHaveBeenCalledWith("Louvores", [
      expect.objectContaining({ itemKey: "v1", videoId: "aaaaaaaaaaa" }),
    ]);

    playOnlineVideoSequence.mockClear();
    // Play direto de uma categoria via evento @play no chip
    await wrapper.find('.stub-chip[data-cat="cat-2"]').trigger("dblclick");
    expect(playOnlineVideoSequence).toHaveBeenCalledWith("Sermões", [
      expect.objectContaining({ itemKey: "v2", videoId: "bbbbbbbbbbb" }),
    ]);
  });
});
