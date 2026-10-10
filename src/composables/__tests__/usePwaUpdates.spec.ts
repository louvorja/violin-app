import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, reactive } from "vue";
import { useUserDataStore } from "@/stores/userDataStore";

const h = vi.hoisted(() => ({
  windows: false,
  playing: false,
  tasks: { value: false },
  sound: { value: false },
  app: null as unknown as { modules: Record<string, { show?: boolean }> },
  flush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: false } }));
vi.mock("@/helpers/Dev", () => ({ default: { write: vi.fn() } }));
vi.mock("@/helpers/Broadcast", () => ({ default: { send: vi.fn() } }));
vi.mock("@/helpers/projection/webWindow", () => ({ hasOpenWebWindows: () => h.windows }));
vi.mock("@/composables/useBackgroundTasks", () => ({
  useBackgroundTasks: () => ({ hasActiveTasks: h.tasks }),
}));
vi.mock("@/composables/useBackgroundSound", () => ({
  useBackgroundSound: () => ({ isPlaying: h.sound }),
}));
vi.mock("@/stores/appStore", () => ({ useAppStore: () => h.app }));
vi.mock("@/helpers/AppData", () => ({ default: { get: () => h.playing } }));
vi.mock("@/helpers/ScheduledStore", () => ({ default: { flush: h.flush } }));
vi.mock("@/helpers/PwaUpdates", () => ({
  subscribePwaUpdates: () => () => {},
  checkPwaUpdate: vi.fn(),
  applyPwaUpdate: async (options: {
    canReload: () => boolean;
    beforeReload: () => Promise<void>;
  }) => {
    if (!options.canReload()) return false;
    await options.beforeReload();
    return options.canReload();
  },
}));
import UserData from "@/helpers/UserData";
import { usePwaUpdates } from "../usePwaUpdates";

describe("aplicação PWA preserva o trabalho atual", () => {
  const scopes: ReturnType<typeof effectScope>[] = [];
  const setup = () => {
    const scope = effectScope();
    scopes.push(scope);
    return scope.run(usePwaUpdates)!;
  };
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.useFakeTimers();
    h.windows = false;
    h.playing = false;
    h.tasks.value = false;
    h.sound.value = false;
    h.app = reactive({ modules: {} });
    h.flush.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    UserData.flushPendingWebSave();
    scopes.splice(0).forEach((scope) => scope.stop());
    vi.useRealTimers();
  });

  it("flags persistidos de apresentação antiga não bloqueiam um boot sem trabalho ativo", async () => {
    localStorage.setItem(
      "user_data",
      JSON.stringify({
        modules: { bible: { is_playing: true }, background_projection: { is_playing: true } },
      })
    );
    await UserData.load();
    expect(setup().blocked.value).toBe(false);
  });

  it("bloqueia janelas, mídias, tarefas e editor abertos, revalidando no clique", async () => {
    const pwa = setup();
    for (const toggle of [
      () => {
        h.windows = true;
      },
      () => {
        h.playing = true;
      },
      () => {
        h.tasks.value = true;
      },
      () => {
        h.sound.value = true;
      },
      () => {
        h.app.modules.slide_editor = { show: true };
      },
    ]) {
      toggle();
      expect(await pwa.apply()).toBe(false);
      expect(h.flush).not.toHaveBeenCalled();
      h.windows = false;
      h.playing = false;
      h.tasks.value = false;
      h.sound.value = false;
      h.app.modules = {};
    }
  });

  it("grava a preferência editada enquanto aguarda o flush da liturgia", async () => {
    let finish!: () => void;
    h.flush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const pwa = setup();
    const pending = pwa.apply();
    const store = useUserDataStore();
    store.theme = "dark";
    UserData.save();
    finish();
    expect(await pending).toBe(true);
    expect(JSON.parse(localStorage.getItem("user_data")!).theme).toBe("dark");
  });
});
