import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import StorageLocations from "../StorageLocations.vue";
import pt from "@/lang/pt.json";

const mocks = vi.hoisted(() => ({
  storage: {
    locations: vi.fn(),
    configureLocations: vi.fn(),
    completeSetup: vi.fn(),
    restart: vi.fn(),
    chooseDir: vi.fn(),
    openDir: vi.fn(),
    recover: vi.fn(),
  },
  classic: {
    getSource: vi.fn(),
    detect: vi.fn(),
    validate: vi.fn(),
    setSource: vi.fn(),
    import: vi.fn(),
  },
  confirm: vi.fn(),
}));
vi.mock("@/helpers/Platform", () => ({
  default: { api: { storage: mocks.storage }, classic: mocks.classic },
}));
vi.mock("@/helpers/Alert", () => ({ default: { confirm: mocks.confirm } }));
vi.mock("@/components/ui", () => ({
  LjButton: {
    props: ["disabled", "loading", "type"],
    template:
      '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>',
  },
  LjDialog: {
    props: ["modelValue", "title"],
    template: '<div v-if="modelValue" data-testid="dialog"><slot /><slot name="footer" /></div>',
  },
  LjCheckbox: {
    props: ["modelValue", "label", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<label><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>',
  },
}));

const initial: StorageLocations = {
  profileDir: "/user/profile",
  mediaDir: "/collection",
  videosDir: "/videos",
  setupCompleted: false,
  restartRequired: false,
  pending: null,
};
const emptyClassic = { dir: null, lang: null, enabled: false, available: false };
const candidate = (dir: string, lang: string | null = "pt") => ({
  dir,
  lang,
  configDir: `${dir}/Config`,
  folders: {},
});
let wrapper: VueWrapper;

async function render(setup = false) {
  wrapper = mount(StorageLocations, {
    props: { setup },
    global: { plugins: [createI18n({ legacy: false, locale: "pt", messages: { pt } })] },
  });
  await flushPromises();
  return wrapper;
}
function button(text: string) {
  const found = wrapper.findAll("button").find((b) => b.text() === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
async function submit() {
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.storage.locations.mockResolvedValue({ ...initial });
  mocks.storage.configureLocations.mockResolvedValue({ ok: true, restartRequired: true });
  mocks.classic.getSource.mockResolvedValue({ ...emptyClassic });
  mocks.classic.detect.mockResolvedValue([]);
  mocks.classic.setSource.mockResolvedValue({ ok: true });
  mocks.classic.validate.mockResolvedValue({ ok: true, lang: "pt" });
  mocks.classic.import.mockResolvedValue({ ok: true });
  mocks.confirm.mockResolvedValue(true);
});
afterEach(() => wrapper?.unmount());

describe("pastas de armazenamento", () => {
  it("mostra o perfil apenas para leitura e conclui o setup padrão sem agendar migração", async () => {
    await render(true);
    expect(wrapper.get('[data-testid="profile-path"]').text()).toBe(initial.profileDir);
    expect(wrapper.findAll("button").filter((b) => b.text() === "Alterar pasta…")).toHaveLength(2);
    await submit();
    expect(mocks.storage.configureLocations).not.toHaveBeenCalled();
    expect(mocks.storage.completeSetup).toHaveBeenCalledOnce();
    expect(wrapper.emitted("complete")).toHaveLength(1);
  });

  it("muda somente vídeos, guarda a ação de cópia e aguarda reinício antes de liberar o setup", async () => {
    await render(true);
    mocks.storage.chooseDir.mockResolvedValue("/external/videos");
    await wrapper
      .findAll("button")
      .filter((b) => b.text() === "Alterar pasta…")[1]
      .trigger("click");
    await flushPromises();
    mocks.storage.locations.mockResolvedValue({
      ...initial,
      restartRequired: true,
      pending: { mediaDir: initial.mediaDir, videosDir: "/external/videos" },
    });
    await submit();
    expect(mocks.storage.configureLocations).toHaveBeenCalledWith({
      mediaDir: initial.mediaDir,
      videosDir: "/external/videos",
      mediaAction: "copy",
      videosAction: "copy",
    });
    expect(wrapper.get('[data-testid="videos-path"]').text()).toBe(initial.videosDir);
    expect(wrapper.text()).toContain("/external/videos");
    expect(wrapper.emitted("complete")).toBeUndefined();
    await button("Reiniciar agora").trigger("click");
    await flushPromises();
    expect(mocks.storage.restart).toHaveBeenCalledOnce();
  });

  it.each([
    { setup: true, reason: "unavailable", expectedAction: "reuse" },
    { setup: false, reason: "unavailable", expectedAction: "copy" },
    { setup: true, reason: "in-use", expectedAction: "copy" },
  ])("escolhe $expectedAction com setup=$setup e padrão $reason", async ({ setup, reason, expectedAction }) => {
    mocks.storage.locations.mockResolvedValue({
      ...initial,
      mediaDir: "/var/lib/louvorja-violin/acervo",
      access: {
        media: { writable: false, shared: true, reason },
        videos: { writable: true, shared: false, reason: null },
      },
    });
    await render(setup);
    mocks.storage.chooseDir.mockResolvedValue("/user/collection");
    await wrapper
      .findAll("button")
      .filter((b) => b.text() === "Alterar pasta…")[0]
      .trigger("click");
    await flushPromises();
    expect((wrapper.get("select").element as HTMLSelectElement).value).toBe(expectedAction);
    await submit();
    expect(mocks.storage.configureLocations).toHaveBeenCalledWith({
      mediaDir: "/user/collection",
      videosDir: initial.videosDir,
      mediaAction: expectedAction,
      videosAction: "copy",
    });
  });

  it("permite reutilizar o acervo de destino sem mover nem copiar o perfil", async () => {
    await render();
    mocks.storage.chooseDir.mockResolvedValue("/shared/collection");
    await wrapper
      .findAll("button")
      .filter((b) => b.text() === "Alterar pasta…")[0]
      .trigger("click");
    await flushPromises();
    expect((wrapper.get("select").element as HTMLSelectElement).value).toBe("copy");
    await wrapper.get("select").setValue("reuse");
    await submit();
    expect(mocks.storage.configureLocations).toHaveBeenCalledWith({
      mediaDir: "/shared/collection",
      videosDir: initial.videosDir,
      mediaAction: "reuse",
      videosAction: "copy",
    });
  });

  it("oferece todos os Classic detectados sem ativar nenhum automaticamente", async () => {
    mocks.classic.detect.mockResolvedValue([
      candidate("/classic-a"),
      candidate("/classic-b", "es"),
    ]);
    await render(true);
    expect(wrapper.text()).toContain("/classic-a");
    expect(wrapper.text()).toContain("/classic-b");
    expect(mocks.classic.setSource).not.toHaveBeenCalled();
    await wrapper
      .findAll("button")
      .filter((b) => b.text() === "Usar esta pasta")[1]
      .trigger("click");
    await submit();
    expect(mocks.classic.setSource).toHaveBeenCalledWith({
      dir: "/classic-b",
      lang: "es",
      enabled: true,
    });
    expect(mocks.classic.import).not.toHaveBeenCalled();
  });

  it("exige escolher o idioma quando o Classic encontrado é ambíguo", async () => {
    mocks.classic.detect.mockResolvedValue([candidate("/classic", null)]);
    await render(true);
    await button("Usar esta pasta").trigger("click");
    expect(wrapper.get('[data-testid="save-storage"]').attributes("disabled")).toBeDefined();
    await wrapper.get("select").setValue("es");
    await submit();
    expect(mocks.classic.setSource).toHaveBeenCalledWith({
      dir: "/classic",
      lang: "es",
      enabled: true,
    });
  });

  it("a seleção manual valida a pasta e mantém o Classic separado dos destinos de download", async () => {
    await render(true);
    mocks.storage.chooseDir.mockResolvedValue("/wine/classic");
    mocks.classic.validate.mockResolvedValue({ ok: true, lang: "es" });
    await button("Escolher pasta...").trigger("click");
    await flushPromises();
    await submit();
    expect(mocks.classic.validate).toHaveBeenCalledWith("/wine/classic");
    expect(mocks.classic.setSource).toHaveBeenCalledWith({
      dir: "/wine/classic",
      lang: "es",
      enabled: true,
    });
    expect(mocks.storage.configureLocations).not.toHaveBeenCalled();
  });

  it("nunca oferece mover o Classic e a cópia preserva a origem", async () => {
    mocks.classic.getSource.mockResolvedValue({
      dir: "/classic",
      lang: "pt",
      enabled: true,
      available: true,
    });
    await render();
    expect(wrapper.text()).not.toContain("Mover");
    await button("Copiar para o acervo do LouvorJA").trigger("click");
    await flushPromises();
    expect(mocks.classic.import).toHaveBeenCalledWith({ dir: "/classic", lang: "pt", move: false });
  });

  it("não conclui setup se a configuração falha e mostra erro como texto", async () => {
    await render(true);
    mocks.storage.chooseDir.mockResolvedValue("/denied");
    await wrapper
      .findAll("button")
      .filter((b) => b.text() === "Alterar pasta…")[0]
      .trigger("click");
    await flushPromises();
    mocks.storage.configureLocations.mockRejectedValue(new Error("<b>Acesso negado</b>"));
    await submit();
    expect(wrapper.get('[role="alert"]').text()).toContain("<b>Acesso negado</b>");
    expect(wrapper.get('[role="alert"]').find("b").exists()).toBe(false);
    expect(mocks.storage.completeSetup).not.toHaveBeenCalled();
    expect(wrapper.emitted("complete")).toBeUndefined();
  });

  it("permite cancelar o agendamento mantendo as pastas atuais", async () => {
    mocks.storage.locations.mockResolvedValue({
      ...initial,
      restartRequired: true,
      pending: { mediaDir: "/next", videosDir: "/next-videos" },
    });
    await render(true);
    mocks.storage.locations.mockResolvedValue({ ...initial });
    await button("Cancelar alteração agendada").trigger("click");
    await flushPromises();
    expect(mocks.storage.configureLocations).toHaveBeenCalledWith({
      mediaDir: initial.mediaDir,
      videosDir: initial.videosDir,
      mediaAction: "reuse",
      videosAction: "reuse",
    });
    expect(wrapper.text()).not.toContain("/next-videos");
    expect(mocks.storage.restart).not.toHaveBeenCalled();
    await submit();
    expect(wrapper.emitted("complete")).toHaveLength(1);
  });

  it("informa acesso somente leitura e pasta compartilhada sem alterar o caminho", async () => {
    mocks.storage.locations.mockResolvedValue({
      ...initial,
      access: {
        media: { writable: false, shared: true },
        videos: { writable: true, shared: false },
      },
    });
    await render();
    expect(wrapper.text()).toContain("somente para leitura");
    expect(wrapper.text()).toContain("mais de um perfil");
    expect(wrapper.get('[data-testid="media-path"]').text()).toBe(initial.mediaDir);
  });

  it("usar a pasta padrão escolhe mover quando a conta é dona da pasta atual, senão copiar", async () => {
    mocks.storage.locations.mockResolvedValue({
      ...initial,
      setupCompleted: true,
      defaults: { mediaDir: "/padrao/acervo", videosDir: "/padrao/videos" },
      canMove: { media: false, videos: true },
    });
    await render();
    expect(wrapper.text()).toContain("/padrao/videos");
    await wrapper.get('[data-testid="videos-use-default"]').trigger("click");
    await wrapper.get('[data-testid="media-use-default"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="videos-use-default"]').exists()).toBe(false);
    await submit();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining("apaga a pasta antiga"));
    expect(mocks.storage.configureLocations).toHaveBeenCalledWith({
      mediaDir: "/padrao/acervo",
      videosDir: "/padrao/videos",
      mediaAction: "copy",
      videosAction: "move",
    });
  });

  it("mover só agenda depois da confirmação", async () => {
    mocks.storage.locations.mockResolvedValue({
      ...initial,
      setupCompleted: true,
      defaults: { mediaDir: "/collection", videosDir: "/padrao/videos" },
      canMove: { media: true, videos: true },
    });
    mocks.confirm.mockResolvedValue(false);
    await render();
    await wrapper.get('[data-testid="videos-use-default"]').trigger("click");
    await submit();
    expect(mocks.storage.configureLocations).not.toHaveBeenCalled();
  });

  it("recuperação: reparar e começar do zero confirmam antes; o reset total leva as escolhas", async () => {
    mocks.storage.locations.mockResolvedValue({
      ...initial,
      setupCompleted: true,
      canMove: { media: false, videos: true },
    });
    await render();
    mocks.confirm.mockResolvedValueOnce(false);
    await wrapper.get('[data-testid="repair-app"]').trigger("click");
    await flushPromises();
    expect(mocks.storage.recover).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="repair-app"]').trigger("click");
    await flushPromises();
    expect(mocks.storage.recover).toHaveBeenLastCalledWith("repair", undefined);
    await wrapper.get('[data-testid="reset-app"]').trigger("click");
    await flushPromises();
    expect(mocks.storage.recover).toHaveBeenLastCalledWith("reset", undefined);

    await wrapper.get('[data-testid="wipe-app"]').trigger("click");
    const boxes = wrapper.get('[data-testid="dialog"]').findAll('input[type="checkbox"]');
    expect(boxes[0].attributes("disabled")).toBeDefined(); // acervo compartilhado
    await boxes[1].setValue(true);
    await wrapper.get('[data-testid="wipe-confirm"]').trigger("click");
    await flushPromises();
    expect(mocks.storage.recover).toHaveBeenLastCalledWith("wipe", { media: false, videos: true });
  });

  it("não mostra recuperação nem pasta padrão no primeiro setup", async () => {
    mocks.storage.locations.mockResolvedValue({
      ...initial,
      defaults: { mediaDir: "/padrao/acervo", videosDir: "/padrao/videos" },
      canMove: { media: true, videos: true },
    });
    await render(true);
    expect(wrapper.find('[data-testid="repair-app"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="videos-use-default"]').exists()).toBe(false);
  });

  it("não permite sobrescrever uma origem Classic que falhou ao carregar", async () => {
    mocks.classic.getSource.mockRejectedValue(new Error("read failed"));
    await render(true);
    expect(wrapper.find('[data-testid="save-storage"]').exists()).toBe(false);
    expect(mocks.classic.setSource).not.toHaveBeenCalled();
    expect(mocks.storage.completeSetup).not.toHaveBeenCalled();
  });
});
