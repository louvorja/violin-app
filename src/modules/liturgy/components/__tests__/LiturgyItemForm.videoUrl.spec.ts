import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import { LjChip, LjInput } from "@/components/ui";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";
import LiturgyItemForm from "../LiturgyItemForm.vue";

const mocks = vi.hoisted(() => ({
  fetchTitle: vi.fn(),
  download: vi.fn(),
  snackbarInfo: vi.fn(),
  snackbarError: vi.fn(),
  snackbarWarning: vi.fn(),
  idbPut: vi.fn(),
  idbGetAll: vi.fn(),
  setFormField: vi.fn(),
  reloadVideos: vi.fn(),
}));

vi.mock("@/modules/liturgy/i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({
  i18nAtual: () => ({ global: { t: (key: string) => key } }),
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: {
    info: mocks.snackbarInfo,
    error: mocks.snackbarError,
    warning: mocks.snackbarWarning,
    show: vi.fn(),
  },
}));
// Só o título é difícil de conseguir num teste: o oEmbed é rede. O resto
// (videoIdFromUrl) é regra pura que vale exercitar de verdade.
vi.mock("@/helpers/OnlineVideo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/OnlineVideo")>()),
  fetchYoutubeTitle: mocks.fetchTitle,
}));
vi.mock("@/composables/useOnlineVideoDownloads", () => ({
  useOnlineVideoDownloads: () => ({ download: mocks.download, stateOf: () => "none" }),
}));
vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    put: mocks.idbPut,
    getAll: vi.fn(async () => []),
    get: vi.fn(async () => null),
    del: vi.fn(async () => {}),
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: vi.fn(() => undefined), set: vi.fn() },
}));
// `onlineVideo` presente é o que `downloadAvailable()` exige no desktop: sem
// ele o aviso "Baixando" não deveria sair (e não sai). O objeto é mutável para
// um caso conseguir simular o web/PWA.
const platform = vi.hoisted(() => ({ isDesktop: true, onlineVideo: {} as object | null }));
vi.mock("@/helpers/Platform", () => ({ default: platform }));
vi.mock("@/helpers/Liturgy", () => ({
  default: {
    validateUrl: (url: string) =>
      !url || /^https?:\/\//.test(url) || /^ftp:\/\//.test(url) ? url : `http://${url}`,
    findScheduledForToday: vi.fn(() => null),
    getActiveDate: vi.fn(() => new Date()),
  },
}));
vi.mock("@/composables/useMusicCatalog", () => ({
  useMusicCatalog: () => ({ musics: { value: [] } }),
}));

const URL_YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function mountForm(overrides: Partial<LiturgyItem> = {}) {
  // `reactive` de propósito: `:disabled="… || !!form.url"` só se atualiza se o
  // objeto do form for reativo — um objeto comum do prop não reage.
  const form = reactive({
    tipo: LiturgyItemTypeEnum.VIDEO_ONLINE,
    id: "i1",
    item: "",
    subitem: "",
    url: "",
    cor: "#fff",
    ...overrides,
  } as LiturgyItem);
  return shallowMount(LiturgyItemForm, {
    global: {
      stubs: {
        // Todo o conteúdo do formulário vive no slot — do diálogo e do campo.
        // O stub padrão do `shallowMount` não renderiza slot, então sem estes
        // overrides o teste só enxergaria <lj-dialog-stub>/<lj-field-stub> e
        // nada do que importa.
        LjDialog: { template: "<div><slot /></div>" },
        LjField: { template: "<div><slot /></div>" },
      },
    },
    props: {
      modelValue: true,
      form,
      videosList: [],
      setFormField: (key: string, value: unknown) => {
        // Registra para os testes que já afirmam sobre ele, e escreve de fato —
        // sem isto limpar a seleção não reabilitaria o campo.
        mocks.setFormField(key, value);
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
      reloadVideos: mocks.reloadVideos,
    },
  }) as VueWrapper;
}

const vm = (wrapper: VueWrapper) =>
  (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;

describe("LiturgyItemForm — URL colada do vídeo on-line", () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    platform.isDesktop = true;
    platform.onlineVideo = {};
    mocks.fetchTitle.mockResolvedValue("Título do YouTube");
    mocks.download.mockResolvedValue(true);
    mocks.idbPut.mockResolvedValue(undefined);
    mocks.reloadVideos.mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("URL válida preenche o item e dispara o download, sem salvar na lista", async () => {
    wrapper = mountForm();
    const state = vm(wrapper);

    state.videoUrl = URL_YOUTUBE;
    await (state.confirmVideoUrl as () => Promise<void>)();
    await flushPromises();

    expect(mocks.setFormField).toHaveBeenCalledWith("url", URL_YOUTUBE);
    expect(mocks.setFormField).toHaveBeenCalledWith("item", "Título do YouTube");
    expect(mocks.setFormField).toHaveBeenCalledWith("subitem", "YouTube");
    // Baixa sempre; o checkbox é quem decide o salvamento.
    expect(mocks.download).toHaveBeenCalledWith("dQw4w9WgXcQ", "Título do YouTube", {
      keep: false,
    });
    expect(mocks.idbPut).not.toHaveBeenCalled();
    expect(mocks.snackbarInfo).toHaveBeenCalledWith("online_video.preparing", expect.anything());
  });

  it("sem YouTube, o link não entra e não há download", async () => {
    wrapper = mountForm();
    const state = vm(wrapper);

    state.videoUrl = "https://exemplo.com/qualquer";
    await (state.confirmVideoUrl as () => Promise<void>)();
    await flushPromises();

    expect(mocks.snackbarError).toHaveBeenCalledWith("inputs.video_url_invalid");
    expect(mocks.setFormField).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.idbPut).not.toHaveBeenCalled();
  });

  it("URL sem protocolo ganha http:// e ainda é reconhecida como YouTube", async () => {
    wrapper = mountForm();
    const state = vm(wrapper);

    state.videoUrl = "youtu.be/dQw4w9WgXcQ";
    await (state.confirmVideoUrl as () => Promise<void>)();
    await flushPromises();

    expect(mocks.setFormField).toHaveBeenCalledWith("url", "http://youtu.be/dQw4w9WgXcQ");
    expect(mocks.download).toHaveBeenCalled();
  });

  it("checkbox ligado: salva em Meus Vídeos Online e recarrega a lista", async () => {
    wrapper = mountForm();
    const state = vm(wrapper);

    (state.setSaveToMyVideos as (_v: boolean) => void)(true);
    state.videoUrl = URL_YOUTUBE;
    await (state.confirmVideoUrl as () => Promise<void>)();
    await flushPromises();

    expect(mocks.idbPut).toHaveBeenCalledTimes(1);
    expect(mocks.idbPut.mock.calls[0][0]).toContain("videos");
    expect(mocks.reloadVideos).toHaveBeenCalledTimes(1);
    expect(mocks.download).toHaveBeenCalledWith("dQw4w9WgXcQ", "Título do YouTube", {
      keep: true,
    });
  });

  it("campo vazio não faz nada", async () => {
    wrapper = mountForm();
    const state = vm(wrapper);

    state.videoUrl = "   ";
    await (state.confirmVideoUrl as () => Promise<void>)();
    await flushPromises();

    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.snackbarError).not.toHaveBeenCalled();
  });

  it("sem suporte a download (web), não anuncia \"Baixando\"", async () => {
    // No web/PWA o `download` devolve false sem baixar nada: avisar assim
    // mesmo faria o operador esperar um download que não vai acontecer.
    platform.onlineVideo = null;
    wrapper = mountForm();
    const state = vm(wrapper);

    state.videoUrl = URL_YOUTUBE;
    await (state.confirmVideoUrl as () => Promise<void>)();
    await flushPromises();

    expect(mocks.snackbarInfo).not.toHaveBeenCalled();
    // O link ainda é aceito e o item continua sendo preenchido.
    expect(mocks.setFormField).toHaveBeenCalledWith("url", URL_YOUTUBE);
  });

  it("sem título do oEmbed, o próprio link vira o nome do item", async () => {
    mocks.fetchTitle.mockResolvedValue(null);
    wrapper = mountForm();
    const state = vm(wrapper);

    state.videoUrl = URL_YOUTUBE;
    await (state.confirmVideoUrl as () => Promise<void>)();
    await flushPromises();

    expect(mocks.setFormField).toHaveBeenCalledWith("item", URL_YOUTUBE);
  });

  it("reabre limpo: sem URL antiga e com o checkbox desligado", async () => {
    wrapper = mountForm();
    const state = vm(wrapper);

    (state.setSaveToMyVideos as (_v: boolean) => void)(true);
    state.videoUrl = URL_YOUTUBE;
    await wrapper.setProps({ modelValue: false });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();

    expect(state.videoUrl).toBe("");
    expect(state.saveToMyVideos).toBe(false);
  });
});
describe("LiturgyItemForm — campo de URL e escolha de catálogo se excluem", () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  /** O campo de URL direta: o único que se liga a `videoUrl`. */
  const campoUrl = (wrapper: VueWrapper) =>
    wrapper
      .findAllComponents(LjInput)
      .find((campo) => campo.props("modelValue") === (vm(wrapper).videoUrl as string));

  const comValorNoCampo = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("sem vídeo escolhido, o campo de URL fica habilitado", async () => {
    wrapper = mountForm();
    const state = vm(wrapper);
    state.videoUrl = comValorNoCampo;
    await flushPromises();

    expect(campoUrl(wrapper)?.props("disabled")).toBe(false);
  });

  it("com vídeo escolhido, o campo de URL fica desabilitado", async () => {
    wrapper = mountForm({ url: comValorNoCampo, item: "Vídeo escolhido" });
    const state = vm(wrapper);
    state.videoUrl = comValorNoCampo;
    await flushPromises();

    // São dois caminhos que se excluem — catálogo e link direto — e o que vale
    // é o que está selecionado no momento.
    expect(campoUrl(wrapper)?.props("disabled")).toBe(true);
  });

  it("o chip do vídeo escolhido traz o X, e limpar devolve o campo", async () => {
    wrapper = mountForm({ url: comValorNoCampo, item: "Vídeo escolhido" });
    const state = vm(wrapper);
    state.videoUrl = comValorNoCampo;
    await flushPromises();

    const chip = wrapper.findAllComponents(LjChip).find((c) => c.props("removable") === true);
    expect(chip).toBeDefined();

    await chip!.vm.$emit("remove");
    await flushPromises();

    expect(mocks.setFormField).toHaveBeenCalledWith("url", "");
    expect(mocks.setFormField).toHaveBeenCalledWith("item", "");
    expect(mocks.setFormField).toHaveBeenCalledWith("subitem", "");
    expect(state.videoUrl).toBe("");
    expect(campoUrl(wrapper)?.props("disabled")).toBe(false);
  });

  it("escolher no seletor zera o campo, senão o 'Usar' o reaplicaria", async () => {
    wrapper = mountForm();
    const state = vm(wrapper);
    state.videoUrl = comValorNoCampo;
    await flushPromises();
    expect(campoUrl(wrapper)?.props("disabled")).toBe(false);

    (state.onVideoSearchPicked as (_v: { name: string; url: string }) => void)({ name: "Vídeo do catálogo", url: "https://www.youtube.com/watch?v=outro1" });
    await flushPromises();

    expect(state.videoUrl).toBe("");
    expect(mocks.setFormField).toHaveBeenCalledWith("url", "https://www.youtube.com/watch?v=outro1");
    expect(campoUrl(wrapper)?.props("disabled")).toBe(true);
  });
});
