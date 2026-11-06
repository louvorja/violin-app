/**
 * Card → chip de categoria na Projeção de Fundo.
 *
 * O DnD nativo cobre mouse/trackpad; o toque usa long press e
 * `elementFromPoint` (o jsdom não implementa nenhum dos dois, então o teste
 * monta os eventos e aponta o alvo explicitamente).
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
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: vi.fn(), listen: () => () => {}, getLastPayload: () => null },
}));
vi.mock("@/helpers/BroadcastTypes", () => ({
  BROADCAST_TYPE: new Proxy({}, { get: (_target, key) => String(key) }),
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { show: (...args: unknown[]) => snackbar(...args) },
}));
vi.mock("@/helpers/Alert", () => ({
  default: { error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/helpers/LocalFailureNotice", () => ({ reportLocalFileFailure: vi.fn() }));
vi.mock("@/helpers/FilePath", () => ({ localPathOf: (path: string) => path }));
vi.mock("@/helpers/ProjectionWindows", () => ({
  closeBackgroundProjectionWindows: vi.fn(async () => {}),
  openBackgroundProjectionWindows: vi.fn(async () => {}),
}));
vi.mock("@/helpers/Path", () => ({ default: { local: (path: string) => `louvorja://${path}` } }));
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
}));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: vi.fn(),
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
vi.mock("@/components/ui", () => {
  const pass = { template: "<span><slot /></span>" };
  return {
    LjButton: {
      props: ["title"],
      template: `<button type="button" :data-title="title" @click="$emit('click', $event)"><slot /></button>`,
    },
    LjDialog: pass,
    LjDivider: pass,
    LjEmpty: pass,
    LjField: pass,
    LjIcon: pass,
    LjInput: { template: "<input />" },
    LjSelect: pass,
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
  name: "fundo.png",
  path: "blob:fundo",
  type: "image" as const,
  categoryId: "",
  addedAt: 1,
  thumb: "data:image/png;base64,AA==",
};

function fakeDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    get types() {
      return Array.from(data.keys());
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

async function mountIndex(
  files: Record<string, unknown>[] = [FILE],
  categories: Record<string, unknown>[] = [CATEGORY]
): Promise<void> {
  idbGetAll.mockImplementation(async (store: string) =>
    store === DB_TABLE.BACKGROUND_PROJECTION_CATEGORIES
      ? categories.map((category) => ({ ...category }))
      : files.map((file) => ({ ...file }))
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

describe("Projeção de Fundo: arrastar card para categoria", () => {
  it("move pelo DnD nativo e persiste a nova categoria", async () => {
    const card = wrapper.find(".bg-grid-item");
    const chip = wrapper.find(`[data-category-drop-id="${CATEGORY.id}"]`);
    const dataTransfer = fakeDataTransfer();

    await card.trigger("dragstart", { dataTransfer });
    expect(dataTransfer.getData(MEDIA_CATEGORY_DRAG_MIME)).toContain(FILE.id);

    await chip.trigger("dragover", { dataTransfer });
    expect(chip.classes()).toContain("lj-category-chip--drop-target");

    await chip.trigger("drop", { dataTransfer });
    await flushPromises();

    expect(idbPut).toHaveBeenCalledWith(
      DB_TABLE.BACKGROUND_PROJECTION_LIBRARY,
      expect.objectContaining({ id: FILE.id, categoryId: CATEGORY.id })
    );
    expect(snackbar).toHaveBeenCalledWith("moved_to_category");
  });

  it("move um item de uma categoria para Sem categoria", async () => {
    wrapper.unmount();
    await mountIndex(
      [{ ...FILE, categoryId: "outra" }],
      [{ ...CATEGORY }, { ...CATEGORY, id: "outra", name: "Outra" }]
    );

    const card = wrapper.find(".bg-grid-item");
    const uncategorized = wrapper.find('[data-category-drop-id=""]');
    const outra = wrapper.find('[data-category-drop-id="outra"]');
    const dataTransfer = fakeDataTransfer();

    expect(uncategorized.exists()).toBe(true);
    expect(outra.find(".lj-category-chip__count").text()).toBe("1");
    expect(uncategorized.find(".lj-category-chip__count").text()).toBe("0");
    expect(card.attributes("style")).toContain("#4CAF50");
    expect(card.find(".lj-category-item-icon").exists()).toBe(true);
    await card.trigger("dragstart", { dataTransfer });
    await uncategorized.trigger("drop", { dataTransfer });
    await flushPromises();

    expect(idbPut).toHaveBeenCalledWith(
      DB_TABLE.BACKGROUND_PROJECTION_LIBRARY,
      expect.objectContaining({ id: FILE.id, categoryId: "" })
    );
  });

  it("move por toque depois de long press", async () => {
    vi.useFakeTimers();
    const card = wrapper.find(".bg-grid-item");
    const chip = wrapper.find(`[data-category-drop-id="${CATEGORY.id}"]`);
    elementFromPoint.mockReturnValue(chip.element as Element);

    card.element.dispatchEvent(dispatchTouch("touchstart", card.element, [touch(10, 10)]));
    vi.advanceTimersByTime(400);
    await nextTick();
    expect(chip.classes()).toContain("lj-category-chip--drop-target");

    dispatchTouch("touchmove", window, [touch(10, 10)]);
    dispatchTouch("touchend", window, []);
    await flushPromises();

    expect(idbPut).toHaveBeenCalledWith(
      DB_TABLE.BACKGROUND_PROJECTION_LIBRARY,
      expect.objectContaining({ id: FILE.id, categoryId: CATEGORY.id })
    );
  });

  it("não projeta o arquivo ao terminar um arrasto por toque", async () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const card = wrapper.find(".bg-grid-item");
    const chip = wrapper.find(`[data-category-drop-id="${CATEGORY.id}"]`);
    elementFromPoint.mockReturnValue(chip.element as Element);

    card.element.dispatchEvent(dispatchTouch("touchstart", card.element, [touch(10, 10)]));
    vi.advanceTimersByTime(400);
    dispatchTouch("touchend", window, []);
    await flushPromises();
    card.element.dispatchEvent(new Event("click", { bubbles: true }));

    expect(setItem).not.toHaveBeenCalled();
  });
});
