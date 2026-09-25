/**
 * O sintoma que originou estes testes não dá erro nem aparece na tela: com a
 * tradução desligada, o app seguia chamando a API do VLibras a cada troca de
 * slide — visível só na aba de rede.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const listeners = vi.hoisted(() => new Map<string, (_payload: unknown) => void>());
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, handler: (_payload: unknown) => void) => {
    listeners.set(type, handler);
  },
}));

const translateText = vi.fn(async () => "GLOSS");
const findCachedByText = vi.fn(async () => null);

vi.mock("@/helpers/Libras", () => ({
  default: {
    stripHtml: (text: string) => text,
    translateText,
    findCachedByText,
    setCached: vi.fn(async () => undefined),
    uniqueTokens: () => ["GLOSS"],
  },
}));

vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback: unknown) => fallback, set: vi.fn() },
}));

vi.mock("@/helpers/Dev", () => ({ default: { write: vi.fn() } }));

async function load(flags: Record<string, string>) {
  // O localStorage do ambiente de teste é um objeto pelado, sem os métodos.
  const guardado = new Map(Object.entries(flags));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => void guardado.set(k, v),
    removeItem: (k: string) => void guardado.delete(k),
  });
  vi.resetModules();
  const { useLibras } = await import("../useLibras");
  const { useLibrasState } = await import("../useLibrasState");
  return { useLibras, useLibrasState };
}

describe("useLibras — guarda de ativação", () => {
  beforeEach(() => {
    listeners.clear();
    translateText.mockClear();
    findCachedByText.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("não chama a API com o Libras desligado", async () => {
    const { useLibras } = await load({ libras_enabled: "false" });
    await useLibras().translateSlide("O meu lugar no mundo");
    expect(translateText).not.toHaveBeenCalled();
    expect(findCachedByText).not.toHaveBeenCalled();
  });

  it("não chama a API com a tradução de músicas desmarcada", async () => {
    const { useLibras } = await load({
      libras_enabled: "true",
      libras_musics_enabled: "false",
    });
    await useLibras().translateSlide("O meu lugar no mundo");
    expect(translateText).not.toHaveBeenCalled();
  });

  it("chama a API com o Libras ligado", async () => {
    const { useLibras } = await load({ libras_enabled: "true" });
    await useLibras().translateSlide("O meu lugar no mundo");
    expect(translateText).toHaveBeenCalledWith("O meu lugar no mundo");
  });

  it("para de chamar quando a tradução é desligada em tempo real", async () => {
    const { useLibras, useLibrasState } = await load({ libras_enabled: "true" });
    const { translateSlide } = useLibras();

    await translateSlide("Primeiro verso");
    expect(translateText).toHaveBeenCalledTimes(1);

    useLibrasState().setEnabled(false);
    await translateSlide("Segundo verso");
    expect(translateText).toHaveBeenCalledTimes(1);
  });

  it("traduz o snapshot validado por sessão e ignora o companheiro versionado", async () => {
    const { useLibras } = await load({ libras_enabled: "true" });
    useLibras();
    const send = (sessionId: string, revision: number, lyric: string,
      selectionRevision = revision, slideIndex = 0) => {
      listeners.get(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)?.({
        schema: 1, selectionRevision, playbackId: sessionId,
        progress: 0, slideProgress: 0, emittedAt: Date.now(),
        snapshot: { sessionId, revision, active: true, title: sessionId,
          slideIndex, totalSlides: 2, slide: { lyric, id_music: 42 },
          nextSlide: slideIndex === 0 ? { lyric: "Next" } : null },
      });
    };
    send("song-a", 2, "Primeiro");
    listeners.get(BROADCAST_TYPE.SLIDE_CHANGE)?.({
      presentation_session: "song-a", presentation_revision: 2,
      slide_index: 0, slide: { lyric: "Companheiro" },
    });
    send("song-a", 1, "Antigo");
    await vi.waitFor(() => expect(translateText).toHaveBeenCalledTimes(1));
    expect(translateText).toHaveBeenCalledWith("Primeiro");

    send("song-b", 1, "Segundo");
    send("song-a", 3, "Atrasado");
    await vi.waitFor(() => expect(translateText).toHaveBeenCalledTimes(2));
    expect(translateText).toHaveBeenLastCalledWith("Segundo");
    listeners.get(BROADCAST_TYPE.SLIDE_CHANGE)?.({ slide_index: 0, slide: { lyric: "Editor" } });
    await vi.waitFor(() => expect(translateText).toHaveBeenCalledTimes(3));
    expect(translateText).toHaveBeenLastCalledWith("Editor");
  });

  it("keeps the refreshed envelope revision while avoiding retranslation of the same slide", async () => {
    const { useLibras } = await load({ libras_enabled: "true" });
    useLibras();
    const send = (revision: number, selectionRevision: number, slideIndex: number, lyric: string) => {
      listeners.get(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT)?.({
        schema: 1, selectionRevision, progress: 0, slideProgress: 0, emittedAt: Date.now(),
        snapshot: { sessionId: "song-a", revision, active: true, title: "Song",
          slideIndex, totalSlides: 2, slide: { lyric, id_music: 42 },
          nextSlide: slideIndex === 0 ? { lyric: "Next" } : null },
      });
    };
    send(4, 8, 0, "Primeiro");
    send(4, 9, 0, "Primeiro");
    send(5, 8, 1, "Antigo");
    await vi.waitFor(() => expect(translateText).toHaveBeenCalledTimes(1));
    send(5, 10, 1, "Segundo");
    await vi.waitFor(() => expect(translateText).toHaveBeenCalledTimes(2));
    expect(translateText).toHaveBeenLastCalledWith("Segundo");
  });
});
