/**
 * Card → chip de categoria na Biblioteca de Mídia.
 *
 * Cobre o DnD nativo e o fallback de toque (long press + `elementFromPoint`).
 * O diálogo de importação não pode abrir no drop interno.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { MEDIA_CATEGORY_DRAG_MIME } from "@/helpers/MediaCategoryDrag";
import { DB_TABLE } from "@/constants/DbTables";

const idbPut = vi.fn(async (_store: string, _value: unknown): Promise<void> => {});
const idbGetAll = vi.fn(async (_store: string): Promise<unknown[]> => []);
const snackbar = vi.fn();

vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: false,
    isMac: false,
    isWeb: true,
    api: { shell: { openPath: vi.fn(async () => ({ ok: false })) } },
    displays: { getPreferred: async () => null },
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback?: unknown) => fallback, set: vi.fn() },
}));
vi.mock("@/helpers/AppData", () => ({
  default: { get: (_key: string, fallback?: unknown) => fallback, set: vi.fn() },
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: {
    show: (...args: unknown[]) => snackbar(...args),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("@/helpers/Alert", () => ({
  default: { confirm: vi.fn(async () => false), error: vi.fn() },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn(), log: vi.fn() },
}));
vi.mock("@/helpers/Http", () => ({
  fetchWithTimeout: vi.fn(async () => null),
  NET_TIMEOUT: { DEFAULT: 1 },
}));
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: vi.fn(), listen: () => () => {}, getLastPayload: () => null },
}));
vi.mock("@/helpers/BroadcastTypes", () => ({
  BROADCAST_TYPE: new Proxy({}, { get: (_target, key) => String(key) }),
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  closeProjectionWindows: vi.fn(async () => {}),
  openSiteWindow: vi.fn(async () => {}),
}));
vi.mock("@/helpers/Path", () => ({ default: { local: (path: string) => `louvorja://${path}` } }));
vi.mock("@/helpers/LocalFailureNotice", () => ({ reportLocalFileFailure: vi.fn() }));
vi.mock("@/helpers/FilePath", () => ({ localPathOf: (path: string) => path }));
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: (...args: unknown[]) => idbGetAll(String(args[0])),
    put: (...args: unknown[]) => idbPut(String(args[0]), args[1]),
    del: vi.fn(async () => {}),
  },
}));
vi.mock("@/helpers/ImageConvert", () => ({
  isHeic: () => false,
  ensureRenderableImage: vi.fn(),
  heicToJpeg: vi.fn(),
}));
vi.mock("@/composables/useViewport", () => ({ useViewport: () => ({ width: 1400 }) }));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: vi.fn(),
}));
vi.mock("@/composables/useMedia", () => ({
  default: {
    projectFile: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    registerNavigationDelegate: vi.fn(),
    unregisterNavigationDelegate: vi.fn(),
    stopAudioFile: vi.fn(),
  },
}));
vi.mock("@/composables/useFileProjection", () => ({
  useFileProjection: () => ({
    isProjecting: { value: false },
    currentType: { value: null },
    currentItemName: { value: "" },
    currentIndex: { value: 0 },
    playlistLength: { value: 0 },
    start: vi.fn(),
    stop: vi.fn(),
    stopProjection: vi.fn(),
  }),
}));
vi.mock("@/components/ModuleContainer.vue", () => ({
  default: {
    methods: { tm: (key: string) => key },
    template: "<div><slot /></div>",
  },
}));
vi.mock("@/components/CategoryManagerDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/CategoryDragGhost.vue", () => ({
  default: { template: "<div class='category-drag-ghost' />" },
}));
vi.mock("./CanvaTab.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/ui", () => {
  const pass = { template: "<span><slot /></span>" };
  return {
    LjButton: {
      props: ["title"],
      template: `<button type="button" :data-title="title" @click="$emit('click', $event)"><slot /></button>`,
    },
    LjDialog: {
      props: ["modelValue"],
      template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
    },
    LjDivider: pass,
    LjEmpty: pass,
    LjIcon: pass,
    LjInput: { template: "<input />" },
    LjTabs: pass,
  };
});

import Index from "../Index.vue";

const CATEGORY = {
  id: "cat1",
  name: "Culto",
  icon: "folder",
  iconType: "icon" as const,
  color: "#4CAF50",
};
const FILE = {
  id: "f1",
  name: "foto.png",
  path: "blob:foto",
  type: "image" as const,
  categoryId: "",
  addedAt: 1,
  thumb: "data:image/png;base64,AA==",
};

function fakeDataTransfer(files: File[] = []): DataTransfer {
  const data = new Map<string, string>();
  return {
    get types() {
      return Array.from(data.keys());
    },
    get files() {
      return files;
    },
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) || "",
  } as unknown as DataTransfer;
}

function touch(clientX: number, clientY: number, identifier = 1): Touch {
  return { identifier, clientX, clientY } as unknown as Touch;
}

function dispatchTouch(type: string, target: EventTarget, touches: Touch[]): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: touches });
  Object.defineProperty(event, "changedTouches", { value: touches });
  target.dispatchEvent(event);
  return event as TouchEvent;
}

let wrapper: VueWrapper;
const elementFromPoint = vi.fn();

async function mountIndex(): Promise<void> {
  idbGetAll.mockImplementation(async (store: string) =>
    store === DB_TABLE.MEDIA_LIBRARY_CATEGORY ? [{ ...CATEGORY }] : [{ ...FILE }]
  );
  wrapper = mount(Index);
  await flushPromises();
}

beforeEach(async () => {
  vi.clearAllMocks();
  idbPut.mockResolvedValue(undefined);
  snackbar.mockClear();
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: elementFromPoint,
  });
  await mountIndex();
});

afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Biblioteca de Mídia: arrastar card para categoria", () => {
  it("move pelo DnD nativo e persiste a nova categoria", async () => {
    const card = wrapper.find(".media-grid-item");
    const chip = wrapper.find(`[data-category-drop-id="${CATEGORY.id}"]`);
    const dataTransfer = fakeDataTransfer();

    await card.trigger("dragstart", { dataTransfer });
    expect(dataTransfer.getData(MEDIA_CATEGORY_DRAG_MIME)).toContain(FILE.id);

    await chip.trigger("dragover", { dataTransfer });
    expect(chip.classes()).toContain("media-chip--drop-target");

    await chip.trigger("drop", { dataTransfer });
    await flushPromises();

    expect(idbPut).toHaveBeenCalledWith(
      DB_TABLE.MEDIA_LIBRARY,
      expect.objectContaining({ id: FILE.id, categoryId: CATEGORY.id })
    );
    expect(snackbar).toHaveBeenCalledWith("moved_to_category");
  });

  it("move por toque depois de long press", async () => {
    vi.useFakeTimers();
    const card = wrapper.find(".media-grid-item");
    const chip = wrapper.find(`[data-category-drop-id="${CATEGORY.id}"]`);
    elementFromPoint.mockReturnValue(chip.element as Element);

    card.element.dispatchEvent(dispatchTouch("touchstart", card.element, [touch(10, 10)]));
    vi.advanceTimersByTime(400);
    await nextTick();
    expect(chip.classes()).toContain("media-chip--drop-target");

    dispatchTouch("touchmove", window, [touch(10, 10)]);
    dispatchTouch("touchend", window, []);
    await flushPromises();

    expect(idbPut).toHaveBeenCalledWith(
      DB_TABLE.MEDIA_LIBRARY,
      expect.objectContaining({ id: FILE.id, categoryId: CATEGORY.id })
    );

    // O clique sintetizado do toque não pode alternar o filtro do chip.
    await chip.trigger("click");
    expect(chip.classes()).toContain("media-chip--active");
  });

  it("clique normal no chip continua alternando o filtro", async () => {
    const chip = wrapper.find(`[data-category-drop-id="${CATEGORY.id}"]`);

    expect(chip.classes()).toContain("media-chip--active");
    await chip.trigger("click");
    expect(chip.classes()).not.toContain("media-chip--active");
  });

  it("drop de arquivo externo continua abrindo a seleção de categoria", async () => {
    const dataTransfer = fakeDataTransfer([
      new File(["conteudo"], "foto.png", { type: "image/png" }),
    ]);

    await wrapper.find(".media-root").trigger("drop", { dataTransfer });
    await flushPromises();

    expect(wrapper.findAll(".media-cat-option").length).toBeGreaterThan(0);
  });

  it("drop interno não abre o diálogo de importação", async () => {
    const card = wrapper.find(".media-grid-item");
    const chip = wrapper.find(`[data-category-drop-id="${CATEGORY.id}"]`);
    const dataTransfer = fakeDataTransfer();
    const categoryDialogs = () => wrapper.findAll(".media-cat-option").length;

    await card.trigger("dragstart", { dataTransfer });
    await chip.trigger("drop", { dataTransfer });
    await flushPromises();

    expect(categoryDialogs()).toBe(0);
  });
});
