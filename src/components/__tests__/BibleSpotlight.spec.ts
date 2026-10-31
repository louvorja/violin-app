import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import BibleSpotlight from "../BibleSpotlight.vue";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";

const mocks = vi.hoisted(() => ({
  databaseGet: vi.fn(),
  appDataGet: vi.fn(),
  broadcastSend: vi.fn(),
  openBibleWindow: vi.fn(),
}));
vi.mock("@/helpers/Database", () => ({ default: { get: mocks.databaseGet } }));
vi.mock("@/helpers/AppData", () => ({ default: { get: mocks.appDataGet } }));
vi.mock("@/helpers/UserData", () => ({ default: { get: () => null, set: vi.fn() } }));
vi.mock("@/helpers/Modules", () => ({ default: { open: vi.fn() } }));
vi.mock("@/helpers/ProjectionWindows", () => ({
  default: { openBibleWindow: mocks.openBibleWindow },
}));
vi.mock("@/helpers/Broadcast", () => ({ default: { send: mocks.broadcastSend } }));

const books = [{ id_bible_book: 1, name: "Gênesis", abbreviation: "Gn", chapters: 50 }];
const versions = [
  { id_bible_version: 1, name: "Versão A", abbreviation: "A" },
  { id_bible_version: 2, name: "Versão B", abbreviation: "B" },
];
const slot = { template: "<div><slot /></div>" };
const global = {
  plugins: [
    createI18n({
      legacy: false,
      locale: "pt",
      messages: { pt: {} },
      missingWarn: false,
      fallbackWarn: false,
    }),
  ],
  stubs: {
    DialogRoot: slot,
    DialogPortal: slot,
    DialogContent: slot,
    DialogOverlay: true,
    DialogTitle: true,
    VisuallyHidden: true,
  },
};

function deferred<T>() {
  let resolve!: (_value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("BibleSpotlight: digitação, carregamento e versão", () => {
  let wrapper: VueWrapper;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.appDataGet.mockReturnValue(1);
    mocks.openBibleWindow.mockResolvedValue(undefined);
    mocks.databaseGet.mockImplementation(async (key: string) =>
      key === "pt_bible_book"
        ? books
        : key === "pt_bible_version"
          ? versions
          : { "1": `${key}:1`, "2": `${key}:2`, "3": `${key}:3` }
    );
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  async function open(props: Record<string, unknown> = {}) {
    wrapper = shallowMount(BibleSpotlight, { props: { modelValue: false, ...props }, global });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    return wrapper.get(".quicknav-hidden-input");
  }

  it("não transforma 12 em capítulo 1 quando há uma pausa de 800 ms", async () => {
    const input = await open();
    await input.trigger("keydown", { key: "g" });
    await input.trigger("keydown", { key: "1" });
    await vi.advanceTimersByTimeAsync(800);
    await input.trigger("keydown", { key: "2" });
    await flushPromises();
    expect(wrapper.get(".quicknav-preview").text()).toBe("Gênesis 12:");
    await input.trigger("keydown", { key: "3" });
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({
      chapter: 12,
      verse: 3,
      text: "bible_1_1_12:3",
    });
  });

  it("confirmar capítulo com espaço não deixa um timer interpretar o versículo como capítulo", async () => {
    const input = await open();
    await input.trigger("keydown", { key: "g" });
    await input.trigger("keydown", { key: "1" });
    await input.trigger("keydown", { key: " " });
    await flushPromises();
    await input.trigger("keydown", { key: "2" });
    await vi.advanceTimersByTimeAsync(800);
    expect(wrapper.get(".quicknav-preview").text()).toBe("Gênesis 1:2");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ chapter: 1, verse: 2 });
  });

  it.each(["keydown", "input"])(
    "preserva versículo e Enter durante o carregamento do capítulo via %s",
    async (mode) => {
      const pending = deferred<Record<string, string>>();
      const defaultGet = mocks.databaseGet.getMockImplementation()!;
      mocks.databaseGet.mockImplementation((key: string) =>
        key === "bible_1_1_12" ? pending.promise : defaultGet(key)
      );
      const input = await open();
      if (mode === "keydown") {
        for (const key of ["g", "1", "2", "3", "Enter"]) await input.trigger("keydown", { key });
      } else {
        await input.setValue("g123");
        await input.trigger("keydown", { key: "Enter" });
      }
      expect(wrapper.emitted("select")).toBeUndefined();
      pending.resolve({ "3": "Texto carregado" });
      await flushPromises();
      expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({
        chapter: 12,
        verse: 3,
        text: "Texto carregado",
      });
    }
  );

  it("descarta o carregamento antigo depois de voltar e escolher outro capítulo", async () => {
    const old = deferred<Record<string, string>>();
    const defaultGet = mocks.databaseGet.getMockImplementation()!;
    mocks.databaseGet.mockImplementation((key: string) =>
      key === "bible_1_1_12" ? old.promise : defaultGet(key)
    );
    const input = await open();
    for (const key of ["g", "1", "2", "Backspace", "2", " "])
      await input.trigger("keydown", { key });
    await flushPromises();
    old.resolve({ "3": "Texto do capítulo antigo" });
    await flushPromises();
    await input.trigger("keydown", { key: "3" });
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({
      chapter: 2,
      verse: 3,
      text: "bible_1_1_2:3",
      reference: "Gênesis 2:3",
    });
  });

  it("usa a versão recebida pelo host e inclui a versão na projeção", async () => {
    const input = await open({ versionId: 2 });
    for (const key of ["g", "1", "2"]) await input.trigger("keydown", { key });
    await flushPromises();
    await input.trigger("keydown", { key: "3" });
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({
      id_bible_version: 2,
      text: "bible_2_1_12:3",
    });
    expect(mocks.broadcastSend).toHaveBeenCalledWith(
      BROADCAST_TYPE.BIBLE_VERSE_INTENT,
      expect.objectContaining({ version_id: 2, version: "B" })
    );
  });

  it("a busca da Shell lê a versão no estado atual do módulo", async () => {
    mocks.appDataGet.mockReturnValue(2);
    const input = await open();
    for (const key of ["g", "1", "2"]) await input.trigger("keydown", { key });
    await flushPromises();
    expect(mocks.appDataGet).toHaveBeenCalledWith(KEYS.MODULES.BIBLE.DATA.ID_BIBLE_VERSION);
    expect(mocks.databaseGet).toHaveBeenCalledWith("bible_2_1_12");
  });

  it("carrega os livros quando já nasce com modelValue true, como na Shell", async () => {
    wrapper = shallowMount(BibleSpotlight, { props: { modelValue: true }, global });
    await flushPromises();
    expect(mocks.databaseGet).toHaveBeenCalledWith("pt_bible_book");
    await wrapper.get(".quicknav-hidden-input").trigger("keydown", { key: "g" });
    expect(wrapper.get(".quicknav-preview").text()).toBe("Gênesis → cap.");
  });

  it("cancelar descarta a confirmação pendente mesmo quando o capítulo chega depois", async () => {
    const pending = deferred<Record<string, string>>();
    const defaultGet = mocks.databaseGet.getMockImplementation()!;
    mocks.databaseGet.mockImplementation((key: string) =>
      key === "bible_1_1_12" ? pending.promise : defaultGet(key)
    );
    const input = await open();
    for (const key of ["g", "1", "2", "3", "Enter"]) await input.trigger("keydown", { key });
    await wrapper.setProps({ modelValue: false });
    pending.resolve({ "3": "Texto recebido após cancelar" });
    await flushPromises();
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(mocks.openBibleWindow).not.toHaveBeenCalled();
    expect(mocks.broadcastSend).not.toHaveBeenCalled();
  });

  it("valida um versículo digitado durante a carga antes de projetar", async () => {
    const pending = deferred<Record<string, string>>();
    const defaultGet = mocks.databaseGet.getMockImplementation()!;
    mocks.databaseGet.mockImplementation((key: string) =>
      key === "bible_1_1_12" ? pending.promise : defaultGet(key)
    );
    const input = await open();
    for (const key of ["g", "1", "2", "9", "9", "Enter"]) await input.trigger("keydown", { key });
    pending.resolve({ "1": "Único versículo" });
    await flushPromises();
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(mocks.broadcastSend).not.toHaveBeenCalled();
  });

  it("trata composição de teclado uma vez, sem duplicar os caracteres", async () => {
    const input = await open();
    await input.trigger("compositionstart");
    await input.trigger("keydown", { key: "g", isComposing: true });
    await input.trigger("compositionend", { data: "g123" });
    await flushPromises();
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.emitted("select")).toHaveLength(1);
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ chapter: 12, verse: 3 });
  });
});

describe("BibleSpotlight: ordinal dos livros (I Samuel, II Samuel)", () => {
  let wrapper: VueWrapper;
  const ordinalBooks = [
    { id_bible_book: 9, name: "I Samuel", abbreviation: "1Sm", chapters: 31 },
    { id_bible_book: 10, name: "II Samuel", abbreviation: "2Sm", chapters: 24 },
    { id_bible_book: 11, name: "I Reis", abbreviation: "1Rs", chapters: 22 },
    { id_bible_book: 12, name: "II Reis", abbreviation: "2Rs", chapters: 25 },
    { id_bible_book: 19, name: "Salmos", abbreviation: "Sl", chapters: 150 },
    { id_bible_book: 23, name: "Isaías", abbreviation: "Is", chapters: 66 },
  ];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.appDataGet.mockReturnValue(1);
    mocks.openBibleWindow.mockResolvedValue(undefined);
    mocks.databaseGet.mockImplementation(async (key: string) =>
      key === "pt_bible_book"
        ? ordinalBooks
        : key === "pt_bible_version"
          ? versions
          : { "1": `${key}:1`, "2": `${key}:2`, "3": `${key}:3` }
    );
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  async function open() {
    wrapper = shallowMount(BibleSpotlight, { props: { modelValue: false }, global });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    return wrapper.get(".quicknav-hidden-input");
  }

  it('"i" lista o grupo I primeiro e Isaías depois, sem auto-confirmar', async () => {
    const input = await open();
    await input.trigger("keydown", { key: "i" });
    await flushPromises();

    const preview = wrapper.get(".quicknav-preview").text();
    expect(preview).toBe("1Sm, 1Rs, Is");
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it('"1s" confirma I Samuel e segue para capítulo e versículo', async () => {
    const input = await open();

    /* "1" é ambíguo (I Samuel, I Reis) e não confirma; "s" fecha em I Samuel. */
    await input.trigger("keydown", { key: "1" });
    await flushPromises();
    expect(wrapper.emitted("select")).toBeUndefined();
    await input.trigger("keydown", { key: "s" });
    await flushPromises();
    expect(wrapper.get(".quicknav-preview").text()).toBe("I Samuel → cap.");

    await input.trigger("keydown", { key: "3" });
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    await input.trigger("keydown", { key: "1" });
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({
      book: "I Samuel",
      id_bible_book: 9,
      chapter: 3,
      verse: 1,
      text: "bible_1_9_3:1",
    });
  });
});
