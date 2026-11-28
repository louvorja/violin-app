import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";
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
vi.mock("@/helpers/Database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/Database")>();
  return { ...actual, default: { ...actual.default, get: vi.fn(async () => null) } };
});
vi.mock("@/helpers/AppData", () => ({
  default: { get: vi.fn(() => 0), set: vi.fn() },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: vi.fn(() => undefined), set: vi.fn() },
}));
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: false } }));
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
vi.mock("@/composables/useOnlineVideoDownloads", () => ({
  useOnlineVideoDownloads: () => ({ download: vi.fn(), refresh: vi.fn(), stateOf: () => "none" }),
}));

const passage = {
  reference: "João 3:16",
  text: "Porque Deus amou o mundo…",
  book_id: 43,
  chapter: 3,
  verses: [16],
  version_id: 1,
};

function mountForm(overrides: Partial<LiturgyItem> = {}, autoTitle?: string) {
  const form = reactive({
    tipo: LiturgyItemTypeEnum.BIBLIA,
    id: "i1",
    item: "",
    subitem: "",
    cor: "#fff",
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
      isAutoItemTitle: (value?: string | null) => !!autoTitle && value === autoTitle,
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
    },
  }) as VueWrapper;
}

const setup = (wrapper: VueWrapper) =>
  (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;

const formOf = (wrapper: VueWrapper): LiturgyItem =>
  (wrapper.props() as unknown as { form: LiturgyItem }).form;

/** Chama uma função exposta pelo `<script setup>` sem repetir o cast em cada teste. */
function run(wrapper: VueWrapper, name: string, ...args: unknown[]): void {
  (setup(wrapper)[name] as (..._: unknown[]) => void)(...args);
}

describe("LiturgyItemForm — título do item Bíblia", () => {
  beforeEach(() => vi.clearAllMocks());

  it("troca o nome automático do tipo pela referência escolhida", async () => {
    const wrapper = mountForm({ item: "Bíblia" }, "Bíblia");
    await flushPromises();

    run(wrapper, "onBibleSelected", {
      id_bible_book: 43,
      id_bible_version: 1,
      book: "João",
      chapter: 3,
      verse: 16,
      reference: "João 3:16",
      text: "Porque Deus amou o mundo…",
    });

    expect(formOf(wrapper).item).toBe("João 3:16");
    expect(formOf(wrapper).bible).toMatchObject({ book_id: 43, verses: [16] });
    wrapper.unmount();
  });

  it("preserva o nome escrito pelo operador", async () => {
    const wrapper = mountForm({ item: "Leitura da Palavra" });
    await flushPromises();

    run(wrapper, "onBibleSelected", {
      id_bible_book: 43,
      id_bible_version: 1,
      book: "João",
      chapter: 3,
      verse: 16,
      reference: "João 3:16",
      text: "Porque Deus amou o mundo…",
    });

    expect(formOf(wrapper).item).toBe("Leitura da Palavra");
    wrapper.unmount();
  });

  it("o nome do vídeo substitui o nome automático do tipo", async () => {
    const wrapper = mountForm(
      { tipo: LiturgyItemTypeEnum.VIDEO_ONLINE, item: "Vídeo on-line" },
      "Vídeo on-line"
    );
    await flushPromises();

    run(wrapper, "preencherNomeSeVazio", "Culto de sábado");

    expect(formOf(wrapper).item).toBe("Culto de sábado");
    wrapper.unmount();
  });

  it("limpar o versículo também limpa o título que era a referência", async () => {
    const wrapper = mountForm({ item: "João 3:16", bible: passage });
    await flushPromises();

    run(wrapper, "clearBibleSelection");

    expect(formOf(wrapper).bible).toBeUndefined();
    expect(formOf(wrapper).item).toBe("");
    wrapper.unmount();
  });
});
