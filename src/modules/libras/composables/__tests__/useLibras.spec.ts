/**
 * O sintoma que originou estes testes não dá erro nem aparece na tela: com a
 * tradução desligada, o app seguia chamando a API do VLibras a cada troca de
 * slide — visível só na aba de rede.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
});
