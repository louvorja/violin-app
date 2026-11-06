import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { h as vh } from "vue";
import { TooltipProvider } from "reka-ui";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const h = vi.hoisted(() => ({
  platform: { isDesktop: true, onlineVideo: null as any },
}));

vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_k: string, fallback?: unknown) => fallback },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn() } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { warning: vi.fn() } }));
vi.mock("@/helpers/Alert", () => ({ default: { yesno: vi.fn() } }));
vi.mock("@/i18n", () => ({ i18nAtual: () => ({ global: { t: (key: string) => key } }) }));

const ID = "T8YHfGrk3ok";
const MB = 1024 ** 2;
const entity = {
  video_id: ID,
  playlist_id: "PL1",
  title: "Louvor",
  sequence: 0,
  default_image: "",
  default_image_base64: "",
};

function fakeApi(disk: { id: string; size: number; usedAt: number; kept: boolean }[] = []) {
  return {
    disk,
    ensure: vi.fn(async (id: string) => {
      disk.push({ id, size: 5 * MB, usedAt: 1, kept: true });
      return { ok: true, id, url: "u", size: 1, cached: false };
    }),
    cancel: vi.fn(async () => true),
    list: vi.fn(async () => disk.map((f) => ({ ...f }))),
    keep: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    onProgress: vi.fn(() => vi.fn()),
  };
}

async function load(disk: Parameters<typeof fakeApi>[0] = []) {
  vi.resetModules();
  h.platform.onlineVideo = fakeApi(disk);
  const { useOnlineVideoDownloads } = await import("@/composables/useOnlineVideoDownloads");
  const downloads = useOnlineVideoDownloads();
  await downloads.refresh();
  const Card = (await import("../OnlineVideoCard.vue")).default;
  return { Card, downloads, api: h.platform.onlineVideo };
}

function mountIn(component: any, props: Record<string, unknown>) {
  return mountUi(
    { render: () => vh(TooltipProvider, { delayDuration: 0 }, () => vh(component, props)) },
    {},
    "pt"
  );
}

const button = (wrapper: any, label: string) => wrapper.find(`button[aria-label="${label}"]`);

beforeEach(() => {
  h.platform.isDesktop = true;
});

describe("OnlineVideoCard — download do vídeo", () => {
  it("mostra o ícone de baixar para um vídeo ainda não baixado", async () => {
    const { Card } = await load();
    const w = mountIn(Card, { entity, variant: "video" });

    expect(button(w, "Baixar para usar sem internet").exists()).toBe(true);
    expect(button(w, "Remover download").exists()).toBe(false);
    expect(w.find(".ov-card-download-badge").text()).toBe("");
  });

  it("mostra o selo e a ação de remover quando o vídeo já está no disco", async () => {
    const { Card } = await load([{ id: ID, size: 132 * MB, usedAt: 1, kept: true }]);
    const w = mountIn(Card, { entity, variant: "video" });

    expect(w.find(".ov-card-download-badge").text()).toContain("132 MB");
    expect(button(w, "Baixar para usar sem internet").exists()).toBe(false);
    expect(button(w, "Remover download").exists()).toBe(true);
  });

  it("clicar no download não seleciona/projeta o vídeo do cartão", async () => {
    const { Card, api } = await load();
    const w = mountIn(Card, { entity, variant: "video" });

    await button(w, "Baixar para usar sem internet").trigger("click");
    await flushPromises();

    expect(api.ensure).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ priority: "foreground", keep: true })
    );
    expect(w.emitted("select")).toBeUndefined();
  });

  it("fora do desktop não mostra o controle de download", async () => {
    h.platform.isDesktop = false;
    const { Card } = await load();
    const w = mountIn(Card, { entity, variant: "video" });

    expect(w.find(".ov-card-download").exists()).toBe(false);
    expect(w.find(".ov-card-download-badge").exists()).toBe(false);
  });

  it("canal e playlist não ganham download no cartão", async () => {
    const { Card } = await load();
    const channel = {
      channel_id: "UC1",
      title: "Canal",
      custom_url: "",
      default_image: "",
    };
    const playlist = {
      playlist_id: "PL1",
      channel_id: "UC1",
      title: "Playlist",
      default_image: "",
    };

    for (const [variant, value] of [
      ["channel", channel],
      ["playlist", playlist],
    ] as const) {
      const w = mountIn(Card, { entity: value, variant });
      expect(w.find(".ov-card-download").exists()).toBe(false);
      expect(w.find(".ov-card-download-badge").exists()).toBe(false);
    }
  });
});
