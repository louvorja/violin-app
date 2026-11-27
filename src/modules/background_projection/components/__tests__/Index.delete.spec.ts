import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { DB_TABLE } from "@/constants/DbTables";

const idbGetAll = vi.fn(async (_store: string): Promise<unknown[]> => []);
const idbDel = vi.fn(async (_store: string, _id: string): Promise<void> => {});
const alertConfirm = vi.fn(async (_text: string, _opts?: Record<string, unknown>) => false);

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
  default: { show: vi.fn() },
}));
vi.mock("@/helpers/Alert", () => ({
  default: {
    confirm: (...args: [string, Record<string, unknown>?]) => alertConfirm(...args),
    error: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/helpers/LocalFailureNotice", () => ({ reportLocalFileFailure: vi.fn() }));
vi.mock("@/helpers/FilePath", () => ({ localPathOf: (path: string) => path }));
vi.mock("@/helpers/ProjectionWindows", () => ({
  closeBackgroundProjectionWindows: vi.fn(async () => {}),
  openBackgroundProjectionWindows: vi.fn(async () => {}),
}));
vi.mock("@/helpers/Path", () => ({ default: { media: (path: string) => path } }));
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: (...args: unknown[]) => idbGetAll(String(args[0])),
    put: vi.fn(async () => {}),
    del: (...args: unknown[]) => idbDel(String(args[0]), String(args[1])),
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
    methods: {
      tm: (key: string, named?: Record<string, unknown>) =>
        named?.name ? `${key}:${String(named.name)}` : key,
      t: (key: string) => key,
    },
    template: "<div><slot /></div>",
  },
}));
vi.mock("@/components/CategoryManagerDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/CategoryDragGhost.vue", () => ({ default: { template: "<div />" } }));
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

const FILE = {
  id: "bg-1",
  name: "ceu.mp4",
  path: "blob:ceu",
  type: "video" as const,
  categoryId: "",
  addedAt: 1,
};

let wrapper: VueWrapper | null = null;

async function mountIndex(): Promise<VueWrapper> {
  idbGetAll.mockImplementation(async (store) =>
    store === DB_TABLE.BACKGROUND_PROJECTION_LIBRARY ? [{ ...FILE }] : []
  );
  const w = mount(Index);
  await flushPromises();
  return w;
}

beforeEach(() => {
  idbGetAll.mockReset();
  idbDel.mockReset();
  alertConfirm.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("exclusão de card na Projeção de Fundo", () => {
  it("pede confirmação e não exclui quando o usuário cancela", async () => {
    alertConfirm.mockResolvedValue(false);
    wrapper = await mountIndex();

    const deleteBtn = wrapper.find('[data-title="delete"]');
    expect(deleteBtn.exists()).toBe(true);
    await deleteBtn.trigger("click");
    await flushPromises();

    expect(alertConfirm).toHaveBeenCalledWith("delete_confirm:ceu.mp4", { destructive: true });
    expect(idbDel).not.toHaveBeenCalled();
    expect(wrapper.findAll(".bg-grid-item")).toHaveLength(1);
  });

  it("exclui o arquivo quando o usuário confirma", async () => {
    alertConfirm.mockResolvedValue(true);
    wrapper = await mountIndex();

    await wrapper.find('[data-title="delete"]').trigger("click");
    await flushPromises();

    expect(alertConfirm).toHaveBeenCalledWith("delete_confirm:ceu.mp4", { destructive: true });
    expect(idbDel).toHaveBeenCalledWith(DB_TABLE.BACKGROUND_PROJECTION_LIBRARY, "bg-1");
    expect(wrapper.findAll(".bg-grid-item")).toHaveLength(0);
  });
});
