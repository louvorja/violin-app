import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { makeI18n } from "@/components/ui/__tests__/mountUi";
import pt from "@/modules/media_library/lang/pt.json";
import es from "@/modules/media_library/lang/es.json";
import { KEYS } from "@/constants/UserDataKeys";
import { SETTINGS_TABLE } from "@/constants/DbTables";

const state = vi.hoisted(() => ({
  /** Valor lido no mount — o componente só lê a chave do fundo personalizado. */
  habilitado: false,
  set: vi.fn(),
  getSetting: vi.fn(),
  saveSetting: vi.fn(),
  broadcast: vi.fn(),
  pickImageData: vi.fn(),
}));

vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (_key: string, fallback: unknown) => state.habilitado ?? fallback,
    set: (key: string, value: unknown) => state.set(key, value),
  },
}));
vi.mock("@/helpers/Modules", () => ({
  default: { getPath: () => "media_library" },
}));
vi.mock("@/helpers/FilePicker", () => ({
  pickImageData: () => state.pickImageData(),
}));
vi.mock("@/helpers/SettingsStorage", () => ({
  getSetting: (id: string) => state.getSetting(id),
  saveSetting: (v: unknown) => state.saveSetting(v),
}));
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: (...args: unknown[]) => state.broadcast(...args) },
}));
/* Os primitivos puxam a árvore inteira da UI; aqui só interessa o botão sair. */
vi.mock("@/components/ui", () => ({
  LjButton: {
    props: ["variant", "size", "icon"],
    template: `<button type="button" class="lj-btn-stub"><slot /></button>`,
  },
  LjIcon: {
    props: ["icon", "size"],
    template: `<span class="lj-icon-stub" />`,
  },
}));

import RibbonFileProjectionSettings from "../RibbonFileProjectionSettings.vue";

function i18nComModulo() {
  const i18n = makeI18n("pt");
  i18n.global.mergeLocaleMessage("pt", { modules: { media_library: pt } });
  i18n.global.mergeLocaleMessage("es", { modules: { media_library: es } });
  return i18n;
}

async function montar(): Promise<VueWrapper> {
  const wrapper = mount(RibbonFileProjectionSettings, {
    global: { plugins: [i18nComModulo()] },
  });
  await flushPromises();
  return wrapper;
}

async function ligar(wrapper: VueWrapper) {
  await wrapper.find("#rfps-custom-background").setValue(true);
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  state.habilitado = false;
  state.set.mockClear();
  state.broadcast.mockClear();
  state.saveSetting.mockReset().mockResolvedValue(undefined);
  state.getSetting.mockReset().mockResolvedValue(null);
  state.pickImageData.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RibbonFileProjectionSettings", () => {
  /*
   * O bug: a ribbon dá ~84px ao grupo e `.rfps-container { height:100% }` fazia
   * o bloco do checkbox ocupar essa altura INTEIRA, jogando cor/ajuste/imagem
   * para fora da caixa — que tem `overflow:hidden`. O checkbox respondia e
   * nada aparecia. O jsdom não mede layout, então o que se trava aqui é a
   * ESTRUTURA que impede a repetição: um container só, opções em coluna ao
   * lado do interruptor.
   */
  it("as opções nascem dentro do MESMO container do checkbox", async () => {
    const wrapper = await montar();
    await ligar(wrapper);

    expect(wrapper.findAll(".rfps-container")).toHaveLength(1);

    const caixa = wrapper.find(".rfps-container");
    const checkbox = wrapper.find("#rfps-custom-background");
    const cor = wrapper.find('input[type="color"]');

    expect(checkbox.element.closest(".rfps-container")).toBe(caixa.element);
    expect(cor.element.closest(".rfps-container")).toBe(caixa.element);
  });

  it("ligar traz cor, ajuste e imagem — tudo na MESMA altura do interruptor", async () => {
    const wrapper = await montar();

    expect(wrapper.find('input[type="color"]').exists()).toBe(false);

    await ligar(wrapper);

    expect(wrapper.find('input[type="color"]').exists()).toBe(true);
    expect(wrapper.find("select").exists()).toBe(true);
    expect(wrapper.find(".opt-bg-pick").exists()).toBe(true);
    /* Três colunas: interruptor+cor+ajuste | imagem | prévia. */
    expect(wrapper.findAll(".rfps-col")).toHaveLength(3);
  });

  it("desligar esconde as opções de novo", async () => {
    const wrapper = await montar();
    await ligar(wrapper);
    expect(wrapper.find('input[type="color"]').exists()).toBe(true);

    await wrapper.find("#rfps-custom-background").setValue(false);
    await nextTick();

    expect(wrapper.find('input[type="color"]').exists()).toBe(false);
    expect(wrapper.findAll(".rfps-col")).toHaveLength(1);
  });

  it("grava a preferência na chave de KEYS, nunca em string literal", async () => {
    const wrapper = await montar();

    await wrapper.find("#rfps-custom-background").setValue(true);

    expect(state.set).toHaveBeenCalledWith(KEYS.OPTIONS.FILE_PROJECTION.BACKGROUND_ENABLED, true);
    /*
     * O valor tem que ser exatamente o que `FileProjection` e a tela de Opções
     * leem — se a chave derivada um dia mudar de um lado só, o interruptor
     * acende e a projeção continua com o fundo de sempre.
     */
    expect(KEYS.OPTIONS.FILE_PROJECTION.BACKGROUND_ENABLED).toBe(
      "options.file_projection.background_enabled"
    );
    expect(state.set.mock.calls[0][0]).toBe(KEYS.OPTIONS.FILE_PROJECTION.BACKGROUND_ENABLED);
  });

  it("nasce ligado quando o storage já diz que está", async () => {
    state.habilitado = true;
    const wrapper = await montar();

    expect(wrapper.find('input[type="color"]').exists()).toBe(true);
    expect(wrapper.find("select").exists()).toBe(true);
  });

  it("trocar a cor agenda a gravação (debounce de300ms) e avisa as telas", async () => {
    vi.useFakeTimers();
    const wrapper = await montar();
    await ligar(wrapper);
    /* Ligar já grava a cor atual (sem debounce) — zera para medir só a troca. */
    state.saveSetting.mockClear();

    const cor = wrapper.find('input[type="color"]');
    (cor.element as HTMLInputElement).value = "#ff0000";
    await cor.trigger("input");
    expect(state.saveSetting).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(state.saveSetting).toHaveBeenCalledWith(
      expect.objectContaining({ id: SETTINGS_TABLE.FILE_PROJECTION_BACKGROUND, color: "#ff0000" })
    );
    expect(state.broadcast).toHaveBeenCalled();
  });

  it("ligar já salva a cor atual, sem esperar o debounce", async () => {
    state.getSetting.mockResolvedValue({ color: "#00ff00", position: "tile" });
    const wrapper = await montar();
    await ligar(wrapper);

    expect(state.saveSetting).toHaveBeenCalledWith(
      expect.objectContaining({ id: SETTINGS_TABLE.FILE_PROJECTION_BACKGROUND, color: "#00ff00" })
    );
  });

  it("escolher imagem grava os bytes e mostra a prévia", async () => {
    state.pickImageData.mockResolvedValue({ data: new ArrayBuffer(4), mime: "image/png" });
    const url = vi.fn(() => "blob:preview");
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL: url, revokeObjectURL: vi.fn() }));
    const wrapper = await montar();
    await ligar(wrapper);

    await wrapper.find(".lj-btn-stub").trigger("click");
    await flushPromises();

    expect(state.saveSetting).toHaveBeenCalledWith(
      expect.objectContaining({ id: SETTINGS_TABLE.FILE_PROJECTION_BACKGROUND, mime: "image/png" })
    );
    expect(wrapper.find(".rfps-preview").exists()).toBe(true);
    vi.unstubAllGlobals();
  });
});
