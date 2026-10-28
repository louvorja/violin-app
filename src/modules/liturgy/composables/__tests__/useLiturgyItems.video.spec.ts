import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { LiturgyItem } from "@/types/Liturgy";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";

const mocks = vi.hoisted(() => ({
  importFile: vi.fn(),
  removeFile: vi.fn(),
  validateFile: vi.fn(),
  platform: { isDesktop: true, api: { storage: { chooseFile: vi.fn() } } },
}));
const saved = ref<LiturgyItem[]>([]);
vi.mock("../../i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key, locale: ref("pt") }),
  chaveLiturgia: (key: string) => key,
}));
vi.mock("../useLiturgyExecution", () => ({ useLiturgyExecution: () => ({}) }));
vi.mock("@/composables/useBroadcastListener", () => ({ useBroadcastListener: vi.fn() }));
vi.mock("@/composables/useMusicCatalog", () => ({
  useMusicCatalog: () => ({ musics: computed(() => []) }),
}));
vi.mock("@/helpers/Overlay", () => ({ readAllSlots: async () => [] }));
vi.mock("@/helpers/Platform", () => ({ default: mocks.platform }));
vi.mock("@/helpers/LiturgyFiles", () => ({
  importLiturgyFile: mocks.importFile,
  removeLiturgyFile: mocks.removeFile,
  validateLiturgyFile: mocks.validateFile,
  LITURGY_FILE_ACCEPT: ".png,.mp4",
}));
vi.mock("@/helpers/Liturgy", () => ({
  default: {
    list: () => saved.value,
    set: (list: LiturgyItem[]) => {
      saved.value = list;
    },
    add: (data: LiturgyItem) => {
      saved.value = [...saved.value, { ...data, id: "item-1" }];
    },
    insert: (data: LiturgyItem) => {
      saved.value = [...saved.value, { ...data, id: "item-1" }];
    },
    update: (id: string, data: Partial<LiturgyItem>) => {
      saved.value = saved.value.map((item) => (item.id === id ? { ...item, ...data } : item));
    },
  },
}));
import { useLiturgyItems } from "../useLiturgyItems";

const URL_YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function videoForm(): ReturnType<typeof useLiturgyItems> {
  const ui = useLiturgyItems(ref(0), ref([]));
  ui.quickAdd(LiturgyItemTypeEnum.VIDEO_ONLINE);
  ui.setFormField("item", "Abertura do culto");
  ui.setFormField("url", URL_YOUTUBE);
  ui.setFormField("subitem", "Título do YouTube");
  return ui;
}

beforeEach(() => {
  vi.clearAllMocks();
  saved.value = [];
});

describe("item de vídeo on-line — o nome exibido na lista", () => {
  it("grava o nome do vídeo no subtítulo, não a URL", async () => {
    const ui = videoForm();
    await ui.saveItem();

    expect(saved.value[0]).toMatchObject({
      tipo: LiturgyItemTypeEnum.VIDEO_ONLINE,
      item: "Abertura do culto",
      url: URL_YOUTUBE,
      subitem: "Título do YouTube",
    });
  });

  it("sem nome do vídeo, o subtítulo cai na URL — nunca em 'URL: ...'", async () => {
    const ui = videoForm();
    ui.setFormField("subitem", "");
    await ui.saveItem();

    expect(saved.value[0].subitem).toBe(URL_YOUTUBE);
    expect(saved.value[0].subitem.startsWith("URL: ")).toBe(false);
  });

  it("o nome do item é preservado ao salvar (nunca vira o título do vídeo)", async () => {
    const ui = videoForm();
    await ui.saveItem();

    expect(saved.value[0].item).toBe("Abertura do culto");
  });
});
