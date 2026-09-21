import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import PlayerActions from "../PlayerActions.vue";
import Screen from "../buttons/Screen.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import { KEYS } from "@/constants/UserDataKeys";
import pt from "@/lang/pt.json";

const openMediaWindow = vi.fn();
const openPlatformWindow = vi.fn();
vi.mock("@/helpers/ProjectionWindows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/ProjectionWindows")>()),
  openMediaWindow: (kind: string, media: string, options: unknown) =>
    openMediaWindow(kind, media, options),
}));
// O menu não pode ter a sua própria via até a plataforma: tudo passa por openMediaWindow.
vi.mock("@/helpers/Projection", () => ({ open: (opts: unknown) => openPlatformWindow(opts) }));

let media: Record<string, unknown> = {};
vi.mock("@/helpers/AppData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in media ? media[key] : fallback) },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback?: unknown) => fallback },
}));

const CONFIG = KEYS.MODULES.MEDIA.CONFIG;

/** O menu de janelas, com os itens que o componente entrega a ele. */
const MenuStub = defineComponent({
  name: "LjMenu",
  props: { items: { type: Array, default: () => [] } },
  template: "<div />",
});

type MenuItem = { label?: string; action?: () => void };

function windowMenuItems(): Record<"projection" | "return" | "operator", MenuItem> {
  const wrapper = mountUi(PlayerActions, {
    global: { stubs: { LjMenu: MenuStub, LScreenBtn: true, LjButton: true } },
  });
  const all = wrapper.findAllComponents(MenuStub).map((menu) => menu.props("items") as MenuItem[]);
  const items = all.find((list) =>
    list.some((item) => item.label === pt.shell.proj_open_projection)
  );
  if (!items) throw new Error("menu de janelas de projeção não encontrado");
  const byLabel = (label: string) => items.find((item) => item.label === label) as MenuItem;
  return {
    projection: byLabel(pt.shell.proj_open_projection),
    return: byLabel(pt.shell.proj_open_return),
    operator: byLabel(pt.shell.proj_open_operator),
  };
}

beforeEach(() => {
  openMediaWindow.mockClear();
  openPlatformWindow.mockClear();
  media = {};
});

const clickAll = (menu: ReturnType<typeof windowMenuItems>) => {
  menu.projection.action?.();
  menu.return.action?.();
  menu.operator.action?.();
};

describe("menu de janelas do player", () => {
  it("todo item abre pela função única de abertura, pedido explicitamente pelo operador", () => {
    clickAll(windowMenuItems());
    expect(openMediaWindow.mock.calls).toEqual([
      ["projection", "music", { explicit: true }],
      ["return", "music", { explicit: true }],
      ["operator", "music", { explicit: true }],
    ]);
    expect(openPlatformWindow).not.toHaveBeenCalled();
  });

  it("com o player embutido do YouTube no ar, a mídia é vídeo on-line", () => {
    media = { [CONFIG.IS_YOUTUBE]: true };
    clickAll(windowMenuItems());
    expect(openMediaWindow.mock.calls.map(([kind, mediaKind]) => [kind, mediaKind])).toEqual([
      ["projection", "video"],
      ["return", "video"],
      ["operator", "video"],
    ]);
  });

  it.each([
    ["baixado", "louvorja://onlinevideo/OvOiXTDTiIk.mp4", "video"],
    ["tocando enquanto baixa", "louvorja://onlinestream/OvOiXTDTiIk/audio", "video"],
    ["de arquivo", "louvorja://local/videos/culto.mp4", "file"],
  ])("vídeo %s: a mídia é %s", (_nome, source, mediaKind) => {
    media = { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: source };
    windowMenuItems().return.action?.();
    expect(openMediaWindow).toHaveBeenCalledWith("return", mediaKind, { explicit: true });
  });

  it.each([
    ["nada tocando", {}, "music"],
    ["player embutido do YouTube", { [CONFIG.IS_YOUTUBE]: true }, "video"],
    [
      "vídeo baixado",
      { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: "louvorja://onlinevideo/x.mp4" },
      "video",
    ],
    [
      "vídeo de arquivo",
      { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: "louvorja://local/videos/culto.mp4" },
      "file",
    ],
  ])("o botão 'Abrir no monitor' recebe a mesma mídia do menu — %s", (_nome, state, mediaKind) => {
    media = state;
    const wrapper = mountUi(PlayerActions, {
      global: { stubs: { LjMenu: MenuStub, LScreenBtn: true, LjButton: true } },
    });
    expect(wrapper.findComponent(Screen).props("media")).toBe(mediaKind);

    windowMenuItems().projection.action?.();
    expect(openMediaWindow).toHaveBeenLastCalledWith("projection", mediaKind, { explicit: true });
  });

  it("depois que o vídeo sai do ar, o menu volta a abrir as janelas de música", () => {
    media = { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: "louvorja://onlinevideo/x.mp4" };
    windowMenuItems().projection.action?.();
    media = {};
    windowMenuItems().projection.action?.();
    expect(openMediaWindow.mock.calls.map(([, mediaKind]) => mediaKind)).toEqual([
      "video",
      "music",
    ]);
  });
});
