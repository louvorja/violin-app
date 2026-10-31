import { describe, expect, it, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import { LjCheckbox } from "@/components/ui";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";
import { createOverlaySlot, type OverlaySlot } from "@/types/Overlay";
import LiturgyItemForm from "../LiturgyItemForm.vue";

vi.mock("@/modules/liturgy/i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({
  i18nAtual: () => ({ global: { t: (key: string) => key } }),
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), show: vi.fn() },
}));
vi.mock("@/helpers/OnlineVideo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/OnlineVideo")>()),
  fetchYoutubeTitle: vi.fn(async () => null),
}));
vi.mock("@/composables/useOnlineVideoDownloads", () => ({
  useOnlineVideoDownloads: () => ({ download: vi.fn(), stateOf: () => "none" }),
}));
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    put: vi.fn(),
    getAll: vi.fn(async () => []),
    get: vi.fn(async () => null),
    del: vi.fn(async () => {}),
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: vi.fn(() => undefined), set: vi.fn() },
}));
vi.mock("@/helpers/Platform", () => ({
  default: { isDesktop: true, onlineVideo: {} },
}));
vi.mock("@/helpers/Liturgy", () => ({
  default: {
    validateUrl: (url: string) => url,
    findScheduledForToday: vi.fn(() => null),
    getActiveDate: vi.fn(() => new Date()),
  },
}));
vi.mock("@/composables/useMusicCatalog", () => ({
  useMusicCatalog: () => ({ musics: { value: [] } }),
}));

const SLOT = createOverlaySlot({ id: "slot-1", name: "Letreiro" });

function mountForm(overrides: Partial<LiturgyItem> = {}, overlaySlots: OverlaySlot[] = []) {
  const form = reactive({
    tipo: LiturgyItemTypeEnum.MUSICA,
    id: "m1",
    item: "Hino",
    subitem: "",
    musica: -1,
    escolha: true,
    subtipo: "sung",
    url: "",
    cor: "#fff",
    linked_overlay_id: "",
    ...overrides,
  } as LiturgyItem);
  return shallowMount(LiturgyItemForm, {
    global: {
      stubs: {
        LjDialog: { template: "<div><slot /></div>" },
        LjField: { template: "<div><slot /></div>" },
      },
    },
    props: {
      modelValue: true,
      form,
      overlaySlots,
      musicsList: [],
      setFormField: (key: string, value: unknown) => {
        (form as unknown as Record<string, unknown>)[key] = value;
      },
      onTypeChange: vi.fn(),
      onMusicChange: vi.fn(),
      onScheduledCategoryChange: vi.fn(),
      setMusicChoice: vi.fn(),
      saveItem: vi.fn(),
      confirmRemove: vi.fn(),
      openSite: vi.fn(),
      chooseFile: vi.fn(async () => {}),
      openSchedulesDialog: vi.fn(),
      reloadVideos: vi.fn(),
    },
  });
}

const linkCheckbox = (wrapper: ReturnType<typeof mountForm>) =>
  wrapper
    .findAllComponents(LjCheckbox)
    .find((checkbox) => checkbox.props("label") === "overlay.link_overlay");

describe("LiturgyItemForm — vínculo de sobreposição", () => {
  it('mostra o vínculo para música "escolher na hora" quando há slot', () => {
    const wrapper = mountForm({}, [SLOT]);
    expect(linkCheckbox(wrapper)).toBeDefined();
    expect(linkCheckbox(wrapper)?.props("disabled")).toBe(false);
  });

  it("com vínculo antigo, o checkbox continua habilitado para desfazer", () => {
    const wrapper = mountForm({ linked_overlay_id: SLOT.id });
    expect(linkCheckbox(wrapper)?.props("disabled")).toBe(false);
  });
});
