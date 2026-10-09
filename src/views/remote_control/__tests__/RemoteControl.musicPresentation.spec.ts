import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import RemoteControl from "../RemoteControl.vue";

const listeners = vi.hoisted(() => new Map<string, (_payload: unknown) => void>());
const postApi = vi.hoisted(() => vi.fn(async () => ({ status: "ok" })));
/**
 * A aba de slides consulta o estado ao abrir. Por padrão "não há música em
 * apresentação", que é o estado neutro e não muda nada nos testes de FSM.
 */
const semMusica = {
  status: "ok",
  supported: true,
  playing: false,
  slides: [],
  currentSlideIndex: 0,
  title: "",
  presentation_session: null,
};
/** O envelope é frouxo de propósito: cada teste devolve um corpo diferente. */
type SlideReply = { ok: boolean; json: () => Promise<unknown> };
const apiFetch = vi.hoisted(() =>
  vi.fn(async (): Promise<SlideReply> => ({ ok: false, json: async () => ({}) }))
);
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, listener: (_payload: unknown) => void) => {
    listeners.set(type, listener);
  },
}));
vi.mock("@/helpers/ApiClient", () => ({
  isTokenInvalid: vi.fn(() => false),
  apiFetch,
  postApi,
}));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });
const packet = (sessionId: string, revision: number, slideIndex: number, active = true,
  selectionRevision = revision) => ({
  schema: 1, selectionRevision, playbackId: sessionId,
  progress: 0, slideProgress: 0, emittedAt: Date.now(),
  snapshot: {
    sessionId, revision, active, title: active ? sessionId : "", slideIndex: active ? slideIndex : 0,
    totalSlides: active ? 2 : 0,
    slide: active ? { lyric: "Verse" } : null,
    nextSlide: active && slideIndex === 0 ? { lyric: "Next" } : null,
  },
});

function emit(type: string, payload: unknown) {
  const listener = listeners.get(type);
  expect(listener).toBeDefined();
  listener!(payload);
}

describe("remote slide selection", () => {
  let wrapper: VueWrapper | null = null;
  beforeEach(() => {
    listeners.clear();
    postApi.mockClear();
    apiFetch.mockReset();
    apiFetch.mockImplementation(async () => ({ ok: true, json: async () => structuredClone(semMusica) }));
    wrapper = shallowMount(RemoteControl, { global: { plugins: [i18n] } });
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("takes music index/title from validated snapshots while retaining editor selections", async () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "List", slide_index: 0 });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 20, 1));
    emit(BROADCAST_TYPE.SLIDE_CHANGE, { presentation_session: "song-a", presentation_revision: 20,
      slide_index: 0, title: "Stale companion" });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 19, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "Late list", slide_index: 0 });
    await flushPromises();
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.currentSlideIndex).toBe(1);
    expect(state.currentTitle).toBe("song-a");

    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-b", 1, 0));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 21, 1));
    expect(state.currentSlideIndex).toBe(0);
    emit(BROADCAST_TYPE.SLIDE_CHANGE, { slide_index: 1, title: "Editor" });
    expect(state.currentSlideIndex).toBe(1);
    expect(state.currentTitle).toBe("Editor");
    expect(state.slides).toEqual([]);
  });

  it("clears the remote slide list on canonical close", () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { slides: [{ lyric: "Cover" }, { lyric: "Verse" }], title: "List" });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 1, 0));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 2, 0, false));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 3, 1));
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.slides).toEqual([]);
    expect(state.currentTitle).toBe("");
  });

  it("holds a new session list until matching snapshot and rejects an old list", () => {
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-a", slides: [{ lyric: "Old" }], title: "Old" });
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.slides).toEqual([]);
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 1, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-b", slides: [{ lyric: "New" }], title: "New" });
    expect(state.slides).toEqual([{ lyric: "Old" }]);

    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-b", 1, 0));
    emit(BROADCAST_TYPE.SLIDES_DATA, { presentation_session: "song-a", slides: [{ lyric: "Late old" }], title: "Late old" });
    expect(state.slides).toEqual([{ lyric: "New" }]);
    expect(state.currentTitle).toBe("song-b");
  });

  it("orders a same-core refresh by selection revision", () => {
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 4, 0, true, 8));
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, {
      ...packet("song-a", 4, 0, true, 9),
      snapshot: { ...packet("song-a", 4, 0, true, 9).snapshot, title: "Refreshed" },
    });
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 5, 0, true, 8));
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    expect(state.currentTitle).toBe("Refreshed");
  });

  it("sends the observed music session with remote slide selection", async () => {
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-a", 4, 0));
    const state = (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
    (state.goToSlide as (index: number) => void)(1);
    await flushPromises();
    expect(postApi).toHaveBeenCalledWith("/api/song-slides", {
      action: "go-to-slide", index: 1, presentation_session: "song-a",
    }, expect.anything());
    (state.closeMedia as () => Promise<void>)();
    await flushPromises();
    expect(postApi).toHaveBeenCalledWith("/api/song-slides", {
      action: "close", presentation_session: "song-a",
    }, expect.anything());
  });
});

describe("remote slide state by query", () => {
  let wrapper: VueWrapper | null = null;
  const comMusica = {
    status: "ok",
    supported: true,
    playing: true,
    slides: [{ lyric: "Capa" }, { lyric: "Verso" }],
    currentSlideIndex: 1,
    title: "A música",
    presentation_session: "song-consulta",
  };

  beforeEach(() => {
    listeners.clear();
    postApi.mockClear();
    apiFetch.mockReset();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });
  /** Abre a tela já com a resposta da consulta engatilhada: é o mount que consulta. */
  const abrir = async (replay: unknown) => {
    apiFetch.mockImplementation(async () => ({ ok: true, json: async () => replay }));
    wrapper = shallowMount(RemoteControl, { global: { plugins: [i18n] } });
    await flushPromises();
  };
  const estado = () =>
    (wrapper!.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
  const abrirSemRede = async () => {
    apiFetch.mockImplementation(async () => {
      throw new Error("sem rede");
    });
    wrapper = shallowMount(RemoteControl, { global: { plugins: [i18n] } });
    await flushPromises();
  };

  it("consulta o estado e manda a sessão da consulta nos comandos, sem depender do stream", async () => {
    // Este é o caso do defeito: nenhum evento de SSE chega. Só a consulta
    // devolve a sessão, e sem ela o desktop descarta todo comando.
    await abrir(comMusica);
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("action=playing-check"));
    expect(estado().slides).toEqual(comMusica.slides);
    expect(estado().currentSlideIndex).toBe(1);
    expect(estado().currentTitle).toBe("A música");

    (estado().goToSlide as (_index: number) => void)(0);
    await flushPromises();
    expect(postApi).toHaveBeenCalledWith("/api/song-slides", {
      action: "go-to-slide", index: 0, presentation_session: "song-consulta",
    }, expect.anything());

    await (estado().closeMedia as () => Promise<void>)();
    expect(postApi).toHaveBeenCalledWith("/api/song-slides", {
      action: "close", presentation_session: "song-consulta",
    }, expect.anything());
  });

  it("não inventa revisão canônica com a resposta da consulta", async () => {
    // A consulta não traz `revision` nem `selectionRevision`. Se elas fossem
    // inventadas aqui, o primeiro snapshot verdadeiro seria descartado como
    // "revisão repetida" e a aba nunca acompanharia a música.
    await abrir(comMusica);
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-consulta", 0, 1));
    await flushPromises();
    expect(estado().currentSlideIndex).toBe(1);
    emit(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, packet("song-consulta", 1, 0));
    await flushPromises();
    expect(estado().currentSlideIndex).toBe(0);
  });

  it("desktop sem apresentação limpa a aba em vez de deixar lixo antigo", async () => {
    await abrir(comMusica);
    expect(estado().slides).toHaveLength(2);
    // Reconsulta é o caminho de recuperação: trocar de aba dispara a consulta.
    apiFetch.mockImplementation(async () => ({ ok: true, json: async () => structuredClone(semMusica) }));
    estado().tab = "slides";
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(estado().slides).toEqual([]);
    expect(estado().currentTitle).toBe("");
    // E o comando seguinte não leva sessão de uma música que não existe.
    (estado().goToSlide as (_index: number) => void)(1);
    await flushPromises();
    expect(postApi).toHaveBeenCalledWith("/api/song-slides", {
      action: "go-to-slide", index: 1,
    }, expect.anything());
  });

  it.each([
    ["resposta não é o contrato do endpoint", { status: "ok", playing: true }],
    ["índice fora de inteiro", { ...comMusica, currentSlideIndex: -1 }],
    ["deck maior que o servidor aceita", { ...comMusica, slides: new Array(10_001).fill({}) }],
    ["sessão com tamanho impossível", { ...comMusica, presentation_session: "x".repeat(129) }],
  ])("resposta fora do contrato não entra na tela: %s", async (_caso, replay) => {
    await abrir(replay);
    expect(estado().slides).toEqual([]);
  });

  it("consulta falhando não derruba o resto do controle remoto", async () => {
    await abrirSemRede();
    const state = estado();
    expect(state.slides).toEqual([]);
    (state.goToSlide as (index: number) => void)(0);
    await flushPromises();
    expect(postApi).toHaveBeenCalled();
  });
});
