import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn() } }));
// Reativo como o store do Pinia que o UserData lê de verdade.
vi.mock("@/helpers/UserData", async () => {
  const { reactive } = await import("vue");
  const prefs = reactive(new Map<string, unknown>());
  return {
    default: {
      prefs,
      get: (key: string, fallback: unknown) => (prefs.has(key) ? prefs.get(key) : fallback),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
  };
});

import $userdata from "@/helpers/UserData";
import { resetCanvaLibrary, useCanvaLibrary } from "../useCanvaLibrary";

const prefs = ($userdata as unknown as { prefs: Map<string, unknown> }).prefs;

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    status: vi.fn().mockResolvedValue({ ok: true, hasCredentials: false, connected: false }),
    setCredentials: vi.fn().mockResolvedValue({ ok: true, hasCredentials: true, connected: false }),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    items: vi.fn().mockResolvedValue({ ok: true, items: [], continuation: null }),
    exportPdf: vi.fn().mockResolvedValue({ ok: true, path: "/cache/canva/abc.pdf" }),
    ...overrides,
  };
}

function install(api: ReturnType<typeof fakeApi> | null): void {
  (window as unknown as { louvorjaApi?: unknown }).louvorjaApi = api ? { canva: api } : undefined;
}

describe("useCanvaLibrary", () => {
  beforeEach(() => {
    resetCanvaLibrary();
    prefs.clear();
  });
  afterEach(() => install(null));

  it("sem credenciais não lista nada e mostra o formulário", async () => {
    const api = fakeApi();
    install(api);
    const canva = useCanvaLibrary();
    await canva.ensureLoaded();
    expect(canva.ready.value).toBe(true);
    expect(canva.hasCredentials.value).toBe(false);
    expect(api.items).not.toHaveBeenCalled();
  });

  it("grava as credenciais, autoriza e já lista a raiz, só com pastas e designs", async () => {
    const api = fakeApi({
      items: vi.fn().mockResolvedValue({
        ok: true,
        items: [
          { type: "folder", id: "f1", name: "Sábado", thumb: null },
          { type: "design", id: "d1", name: "Avisos", thumb: null },
          { type: "image", id: "i1", name: "Foto", thumb: null },
        ],
        continuation: null,
      }),
    });
    install(api);
    const canva = useCanvaLibrary();
    await canva.ensureLoaded();
    api.status.mockResolvedValue({ ok: true, hasCredentials: true, connected: true });

    const result = await canva.connect({ clientId: " id ", clientSecret: " segredo " });
    await vi.waitFor(() => expect(canva.loading.value).toBe(false));

    expect(result).toBe("connected");
    expect(api.setCredentials).toHaveBeenCalledWith("id", "segredo");
    expect(api.items).toHaveBeenCalledWith({ folderId: "root", continuation: null });
    expect(canva.items.value.map((i) => i.id)).toEqual(["f1", "d1"]);
  });

  it("credencial recusada não abre a autorização", async () => {
    const api = fakeApi({
      setCredentials: vi.fn().mockResolvedValue({ ok: false, code: "invalid", message: "Client ID inválido" }),
    });
    install(api);
    const canva = useCanvaLibrary();

    expect(await canva.connect({ clientId: "x", clientSecret: "y" })).toBe("failed");
    expect(api.connect).not.toHaveBeenCalled();
    expect(canva.error.value).toBe("Client ID inválido");
  });

  it("exporta o design uma vez por versão e devolve a entrada de PDF", async () => {
    const api = fakeApi();
    install(api);
    const canva = useCanvaLibrary();
    const design: CanvaItem = { type: "design", id: "d1", name: "Avisos", thumb: null, updatedAt: 10 };

    const entry = await canva.exportDesign(design);
    expect(entry).toMatchObject({ name: "Avisos.pdf", path: "/cache/canva/abc.pdf", ext: "pdf", isDir: false });
    expect(canva.exportedPath(design)).toBe("/cache/canva/abc.pdf");

    await canva.exportDesign(design);
    expect(api.exportPdf).toHaveBeenCalledTimes(1);

    await canva.exportDesign({ ...design, updatedAt: 11 });
    expect(api.exportPdf).toHaveBeenCalledTimes(2);
  });

  it("export que falha não vira entrada e mostra o motivo", async () => {
    install(fakeApi({ exportPdf: vi.fn().mockResolvedValue({ ok: false, message: "Sem escopo" }) }));
    const canva = useCanvaLibrary();
    expect(await canva.exportDesign({ type: "design", id: "d1", name: "A", thumb: null })).toBeNull();
    expect(canva.error.value).toBe("Sem escopo");
  });

  it("no navegador fica indisponível", async () => {
    install(null);
    const canva = useCanvaLibrary();
    await canva.ensureLoaded();
    expect(canva.available()).toBe(false);
    expect(canva.ready.value).toBe(true);
  });

  it("o modo é a preferência de Integrações, e trocar aqui grava lá", () => {
    const canva = useCanvaLibrary();
    expect(canva.mode.value).toBe("pdf");
    canva.mode.value = "site";
    expect(prefs.get("options.integrations.canva.project_as")).toBe("site");
    expect(canva.mode.value).toBe("site");
  });

  it("o login no site atualiza a sessão", async () => {
    const api = fakeApi({ webLogin: vi.fn().mockResolvedValue({ ok: true }) });
    api.status.mockResolvedValue({ ok: true, hasCredentials: true, connected: true, webSession: true });
    install(api);
    const canva = useCanvaLibrary();
    expect(await canva.webLogin()).toBe(true);
    expect(canva.status.value?.webSession).toBe(true);
  });

  it("o link do site para o programa sai vazio quando o Canva não responde", async () => {
    install(fakeApi({ designUrl: vi.fn().mockResolvedValue({ ok: false }) }));
    expect(await useCanvaLibrary().siteUrl({ type: "design", id: "d1", name: "A", thumb: null })).toBe("");
  });
});
