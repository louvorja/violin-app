import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, ref } from "vue";

const quickPlay = vi.fn(() => true);
const castelo = { id_music: 73, name: "Castelo Forte", has_instrumental_music: true };
const runMusic = vi.fn();
const runModule = vi.fn();

const commands = [
  {
    id: "music:73",
    title: "Castelo Forte",
    category: "music",
    tracks: [73],
    music: castelo,
    run: runMusic,
  },
  { id: "module:bible", title: "Bíblia", category: "module", run: runModule },
];

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("@/helpers/QuickPlay", () => ({
  quickPlay: (...args: unknown[]) => quickPlay(...(args as [])),
  isQuickPlayEnter: (e: KeyboardEvent) =>
    e.key === "Enter" && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey,
}));
vi.mock("@/helpers/CommandRegistry", () => ({
  default: {
    getAll: async () => commands,
    search: (q: string) => ({
      results: commands.filter((c) => c.title.toLowerCase().includes(q.toLowerCase())),
    }),
    isLoaded: () => true,
    visibleCommands: () => commands,
  },
}));
vi.mock("@/helpers/Database", () => ({ default: {} }));
vi.mock("@/helpers/UserData", () => ({ default: { get: () => null } }));
vi.mock("@/composables/useAppTheme", () => ({ useAppTheme: () => ({ toggleDark: () => {} }) }));
vi.mock("@/composables/useMusicCatalog", () => ({ useDisabledAlbums: () => ref([]) }));
vi.mock("@/composables/useSobreposicaoGlobal", () => ({ useSobreposicaoGlobal: () => {} }));

const CommandPalette = (await import("../CommandPalette.vue")).default;

let wrapper: VueWrapper | null = null;

async function abrir() {
  // Como no Shell: a paleta é montada (v-if) a cada abertura.
  wrapper = mount(CommandPalette, {
    props: { modelValue: true },
    attachTo: document.body,
    global: { mocks: { $t: (k: string) => k } },
  });
  await flushPromises();
  await nextTick();
}

function campo(): HTMLInputElement {
  return document.querySelector(".cmd-input") as HTMLInputElement;
}

async function digitar(texto: string) {
  campo().value = texto;
  campo().dispatchEvent(new Event("input"));
  await nextTick();
}

function enter(shiftKey = false) {
  campo().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true, cancelable: true })
  );
}

function fechar() {
  wrapper?.unmount();
  wrapper = null;
}

beforeEach(() => {
  quickPlay.mockClear();
  runMusic.mockClear();
  runModule.mockClear();
});

afterEach(() => fechar());

describe("CommandPalette — busca rápida pelo teclado", () => {
  it("Enter executa a música como antes", async () => {
    await abrir();
    await digitar("castelo");
    enter();
    expect(runMusic).toHaveBeenCalledOnce();
    expect(quickPlay).not.toHaveBeenCalled();
    expect(wrapper!.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("Shift+Enter toca o playback da música", async () => {
    await abrir();
    await digitar("73");
    enter(true);
    expect(quickPlay).toHaveBeenCalledWith(castelo, true);
    expect(runMusic).not.toHaveBeenCalled();
    expect(wrapper!.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("sem playback, a paleta fica aberta", async () => {
    quickPlay.mockReturnValueOnce(false);
    await abrir();
    await digitar("73");
    enter(true);
    expect(wrapper!.emitted("update:modelValue")).toBeUndefined();
  });

  it("reabriu: a última busca de música volta selecionada", async () => {
    await abrir();
    await digitar("castelo");
    enter();
    fechar();

    await abrir();
    expect(campo().value).toBe("castelo");
    expect([campo().selectionStart, campo().selectionEnd]).toEqual([0, 7]);
  });

  it("abriu um módulo pela paleta: a próxima abertura começa limpa", async () => {
    await abrir();
    await digitar("bíblia");
    enter();
    expect(runModule).toHaveBeenCalledOnce();
    fechar();

    await abrir();
    expect(campo().value).toBe("");
  });
});
