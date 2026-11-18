import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref, shallowRef } from "vue";
import type { BibleChapter } from "../../program/bible";

/**
 * Aba Bíblia da biblioteca: a coluna de capítulos fica sempre à vista — com os
 * versículos abertos ou não — e acompanha o livro escolhido.
 */

const books = ref([
  { id_bible_book: 1, name: "João", chapters: 3, color: "#123456" },
]);
const versions = ref([{ id_bible_version: 1, abbreviation: "ARA" }]);
const versionId = ref<number | null>(1);
const bookId = ref<number | null>(1);
const chapter = shallowRef<BibleChapter | null>(null);
const loading = ref(false);
const openBook = vi.fn((id: number) => {
  bookId.value = id;
  chapter.value = null;
});
const openChapter = vi.fn(async (_bookId: number, _n: number) => {});
const setVersion = vi.fn(async () => {});
const ensureLoaded = vi.fn(async () => {});

vi.mock("../../composables/useBibleLibrary", () => ({
  useBibleLibrary: () => ({
    books,
    versions,
    versionId,
    bookId,
    chapter,
    loading,
    book: computed(() => books.value.find((b) => b.id_bible_book === bookId.value) ?? null),
    openBook,
    openChapter,
    setVersion,
    ensureLoaded,
  }),
}));

const textos: Record<string, string> = {
  "bible.books": "Livros",
  "bible.chapters": "Capítulos",
  "bible.pick_book": "Escolha um livro para ver os capítulos.",
  "bible.pick_book_short": "Escolha um livro",
  "bible.pick_chapter": "Escolha um capítulo para ler os versículos.",
  "bible.title": "Bíblia",
  "bible.prev_chapter": "Capítulo anterior",
  "bible.next_chapter": "Próximo capítulo",
  "bible.version": "Versão",
  "bible.hint": "dica",
  "library.loading": "Carregando…",
  "library.play": "Reproduzir",
  "library.add_to_program": "Adicionar",
};

vi.mock("@/composables/useModuleI18n", async () => {
  const { ref: vueRef } = await import("vue");
  return {
    useModuleI18n: () => ({
      tm: (key: string) => textos[key] ?? key,
      locale: vueRef("pt"),
    }),
  };
});

import LibraryBible from "../LibraryBible.vue";

const stubs = {
  LjInput: {
    props: ["modelValue", "placeholder", "ariaLabel"],
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" :placeholder="placeholder" :aria-label="ariaLabel" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  LjButton: { template: "<button><slot /></button>" },
  LjIcon: true,
  LjSelect: true,
  LjTooltip: { template: "<span><slot /></span>" },
};

function mountBible() {
  return mount(LibraryBible, {
    props: { live: null },
    global: { stubs },
  });
}

const capitulos = (wrapper: ReturnType<typeof mountBible>) =>
  wrapper.findAll('[data-testid^="pm-bible-chapter-"]');

describe("LibraryBible — coluna de capítulos", () => {
  it("mostra os capítulos mesmo antes de abrir um capítulo", async () => {
    bookId.value = 1;
    chapter.value = null;
    const wrapper = mountBible();

    expect(wrapper.find('[data-testid="pm-bible-chapters"]').exists()).toBe(true);
    expect(capitulos(wrapper)).toHaveLength(3);
    expect(wrapper.text()).toContain("Escolha um capítulo");
    expect(
      wrapper.find('.pm-bible__chapters-head [data-testid="pm-bible-jump-input"]').exists()
    ).toBe(true);

    await wrapper.find('[data-testid="pm-bible-chapter-2"]').trigger("click");
    expect(openChapter).toHaveBeenCalledWith(1, 2);
  });

  it("continua visível e marca o capítulo aberto com os versículos na tela", async () => {
    bookId.value = 1;
    chapter.value = {
      versionId: 1,
      version: "ARA",
      bookId: 1,
      book: "João",
      chapter: 2,
      verses: { "1": "No princípio era o Verbo." },
    };

    const wrapper = mountBible();

    expect(wrapper.find('[data-testid="pm-bible-chapters"]').exists()).toBe(true);
    expect(capitulos(wrapper)).toHaveLength(3);
    expect(wrapper.find('[data-testid="pm-bible-verses"]').exists()).toBe(true);
    const ativo = wrapper.find('[data-testid="pm-bible-chapter-2"]');
    expect(ativo.classes()).toContain("pm-chapter--active");
    expect(ativo.attributes("aria-current")).toBe("page");
    expect(
      (wrapper.find('[data-testid="pm-bible-jump-input"]').element as HTMLInputElement).value
    ).toBe("2");
  });

  it("digitar o número e apertar Enter abre o capítulo", async () => {
    bookId.value = 1;
    chapter.value = null;
    openChapter.mockClear();
    const wrapper = mountBible();

    const input = wrapper.find('[data-testid="pm-bible-jump-input"]');
    await input.setValue("3");
    await input.trigger("keydown.enter");

    expect(openChapter).toHaveBeenCalledWith(1, 3);
  });

  it("ignora número fora do livro", async () => {
    bookId.value = 1;
    chapter.value = null;
    openChapter.mockClear();
    const wrapper = mountBible();

    const input = wrapper.find('[data-testid="pm-bible-jump-input"]');
    await input.setValue("9");
    await input.trigger("keydown.enter");

    expect(openChapter).not.toHaveBeenCalled();
  });

  it("abre sozinho depois que a digitação assenta", async () => {
    vi.useFakeTimers();
    try {
      bookId.value = 1;
      chapter.value = null;
      openChapter.mockClear();
      const wrapper = mountBible();

      const input = wrapper.find('[data-testid="pm-bible-jump-input"]');
      await input.setValue("2");
      await vi.advanceTimersByTimeAsync(450);

      expect(openChapter).toHaveBeenCalledWith(1, 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem livro escolhido, a coluna existe e pede um livro", () => {
    bookId.value = null;
    chapter.value = null;
    const wrapper = mountBible();

    expect(wrapper.find('[data-testid="pm-bible-chapters"]').exists()).toBe(true);
    expect(capitulos(wrapper)).toHaveLength(0);
    expect(wrapper.find('[data-testid="pm-bible-chapters"]').text()).toContain(
      "Escolha um livro"
    );
  });

  it("digitar o versículo seleciona e pré-visualiza", async () => {
    bookId.value = 1;
    chapter.value = {
      versionId: 1,
      version: "ARA",
      bookId: 1,
      book: "João",
      chapter: 1,
      verses: { "1": "Um", "2": "Dois", "3": "Três" },
    };
    const wrapper = mountBible();

    const input = wrapper.find('[data-testid="pm-bible-verse-jump"]');
    expect(input.exists()).toBe(true);
    await input.setValue("2");
    await input.trigger("keydown.enter");

    const preview = wrapper.emitted("preview")?.[0]?.[0] as {
      ref: { verses: number[] };
    };
    expect(preview.ref.verses).toEqual([2]);
    expect(wrapper.find('[data-testid="pm-verse-2"]').classes()).toContain("pm-verse--selected");
  });

  it("ignora versículo que não existe no capítulo", async () => {
    bookId.value = 1;
    chapter.value = {
      versionId: 1,
      version: "ARA",
      bookId: 1,
      book: "João",
      chapter: 1,
      verses: { "1": "Um", "2": "Dois" },
    };
    const wrapper = mountBible();

    const input = wrapper.find('[data-testid="pm-bible-verse-jump"]');
    await input.setValue("9");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("preview")).toBeUndefined();
  });
});
