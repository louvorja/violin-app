import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref, shallowRef } from "vue";
import { makeI18n } from "@/components/ui/__tests__/mountUi";
import requiresNetwork from "@/directives/requiresNetwork";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";

/**
 * Tela "Procurar Atualizações" no navegador/PWA. Cada caso é um comportamento
 * que estava errado e só aparecia ao vivo: o banco "atualizava" sem trocar o
 * catálogo, a checagem respondia com a versão de antes e o botão de limpar
 * levava junto o rascunho do editor de slides.
 */
const probe = vi.hoisted(() => ({
  downloadBundle: vi.fn(),
  invalidate: vi.fn(),
  invalidateAll: vi.fn(),
  dbGet: vi.fn(),
  installed: vi.fn(),
  fetchWithTimeout: vi.fn(),
  snackbarWarning: vi.fn(),
  pwaCheck: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("@/helpers/Platform", () => ({
  default: { isDesktop: false, updater: null, api: null },
}));
vi.mock("@/composables/usePwaUpdates", () => ({
  usePwaUpdates: () => ({
    state: shallowRef({ status: "idle", ready: false, lastCheckedAt: null }),
    blocked: ref(false),
    check: probe.pwaCheck,
    apply: vi.fn(),
  }),
}));
vi.mock("@/composables/useSyncManager", () => ({
  useSyncManager: () => ({
    downloadBundle: probe.downloadBundle,
    cancelBundle: vi.fn(),
    bundleInstalling: ref(false),
    bundlePercent: ref(0),
    bundleProgress: ref({ phase: "download", current: 0, total: 0 }),
    humanSize: (n: number) => String(n),
  }),
}));
vi.mock("@/composables/useBackgroundTasks", () => ({
  useBackgroundTasks: () => ({ tasks: ref([]) }),
}));
vi.mock("@/helpers/Database", () => ({
  default: {
    get: (...args: unknown[]) => probe.dbGet(...args),
    getLocal: (...args: unknown[]) => probe.dbGet(...args),
    invalidate: (...args: unknown[]) => probe.invalidate(...args),
    invalidateAll: (...args: unknown[]) => probe.invalidateAll(...args),
  },
}));
vi.mock("@/helpers/BundleInstaller", () => ({
  default: { getInstalledBundleVersion: probe.installed },
}));
vi.mock("@/helpers/Http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/Http")>()),
  fetchWithTimeout: (...args: unknown[]) => probe.fetchWithTimeout(...args),
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback: unknown) => fallback, set: vi.fn() },
}));
vi.mock("@/helpers/Alert", () => ({
  default: { error: vi.fn(), info: vi.fn(), yesno: vi.fn() },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn(), captureException: vi.fn() },
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { warning: probe.snackbarWarning, error: vi.fn() },
}));
vi.mock("@/helpers/DatabaseBackup", () => ({
  default: { exportAll: vi.fn(), importAll: vi.fn() },
}));

import AppMenuAtualizacoes from "../AppMenuAtualizacoes.vue";

const dbConfig = (version: number) => ({
  datetime: "2026-10-13 10:00:00",
  latest_updated: "2026-10-13 10:00:00",
  version,
  version_number: version,
});

function configResponse(version: number) {
  return { ok: true, status: 200, json: async () => dbConfig(version) };
}

let wrapper: VueWrapper | null = null;

async function montar() {
  wrapper = mount(AppMenuAtualizacoes, {
    global: {
      plugins: [makeI18n("pt")],
      directives: { "requires-network": requiresNetwork },
    },
  });
  await flushPromises();
  return wrapper;
}

function secao(w: VueWrapper, titulo: string) {
  const found = w.findAll("section.opt-section").find((s) => s.get("h3").text().includes(titulo));
  if (!found) throw new Error(`seção "${titulo}" não encontrada`);
  return found;
}

function botao(root: ReturnType<typeof secao>, texto: string) {
  const found = root.findAll("button").find((b) => b.text() === texto);
  if (!found) throw new Error(`botão "${texto}" não encontrado`);
  return found;
}

beforeEach(() => {
  setActivePinia(createPinia());
  $appdata.set(KEYS.SHELL.IS_ONLINE, true);
  sessionStorage.clear();
  sessionStorage.setItem(
    "slide_editor_song_v2",
    JSON.stringify({ slides: [{ text: "rascunho" }] })
  );
  probe.downloadBundle.mockReset().mockResolvedValue(true);
  probe.invalidate.mockReset();
  probe.invalidateAll.mockReset().mockResolvedValue(undefined);
  probe.dbGet.mockReset().mockResolvedValue(dbConfig(100));
  probe.installed.mockReset().mockResolvedValue(100);
  probe.fetchWithTimeout.mockReset().mockResolvedValue(configResponse(101));
  probe.snackbarWarning.mockReset();
  probe.pwaCheck.mockReset();
  probe.reload.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: probe.reload },
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

describe("Procurar Atualizações — banco no web/PWA", () => {
  it("config consultado recentemente não faz o catálogo antigo parecer instalado", async () => {
    probe.dbGet.mockResolvedValue(dbConfig(101));
    probe.installed.mockResolvedValue(100);
    const w = await montar();
    expect(secao(w, "Banco de dados").text()).toContain(
      "Nova versão v101 - 101 do banco disponível"
    );
  });
  it("pergunta a versão à rede, sem aceitar resposta guardada", async () => {
    await montar();

    const [url, init] = probe.fetchWithTimeout.mock.calls[0];
    expect(String(url)).toMatch(/\/config$/);
    expect(init.cache).toBe("no-store");
  });

  it("'Atualizar agora' instala o pacote do catálogo, como o desktop", async () => {
    const w = await montar();
    const db = secao(w, "Banco de dados");
    expect(db.text()).toContain("Nova versão v101 - 101 do banco disponível");
    vi.useFakeTimers();

    await botao(db, "Atualizar agora").trigger("click");
    await vi.advanceTimersByTimeAsync(1000);

    expect(probe.downloadBundle).toHaveBeenCalledWith({ catalogOnly: true, version: 101 });
    expect(probe.invalidate).not.toHaveBeenCalledWith("config");
    expect(probe.reload).toHaveBeenCalledOnce();
  });

  it("'Atualizar agora' preserva o rascunho do editor de slides", async () => {
    const w = await montar();
    vi.useFakeTimers();

    await botao(secao(w, "Banco de dados"), "Atualizar agora").trigger("click");
    await vi.advanceTimersByTimeAsync(1000);

    expect(sessionStorage.getItem("slide_editor_song_v2")).not.toBeNull();
  });

  it("se o pacote não instalou, avisa e não recarrega", async () => {
    probe.downloadBundle.mockResolvedValue(false);
    const w = await montar();
    vi.useFakeTimers();

    await botao(secao(w, "Banco de dados"), "Atualizar agora").trigger("click");
    await vi.advanceTimersByTimeAsync(3000);

    expect(probe.snackbarWarning).toHaveBeenCalledOnce();
    expect(probe.reload).not.toHaveBeenCalled();
  });

  it("'Limpar cache' esvazia o banco inteiro e não toca no sessionStorage", async () => {
    const w = await montar();

    await botao(secao(w, "Banco de dados"), "Limpar cache").trigger("click");
    await flushPromises();

    expect(probe.invalidateAll).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("slide_editor_song_v2")).not.toBeNull();
    expect(secao(w, "Banco de dados").text()).toContain("Cache limpo.");
  });
});

describe("Procurar Atualizações — app no web/PWA", () => {
  it("sem rede da API, o Verificar do app continua valendo e o do banco não", async () => {
    $appdata.set(KEYS.SHELL.IS_ONLINE, false);
    const w = await montar();

    const app = botao(secao(w, "Atualização do app"), "Verificar");
    const db = botao(secao(w, "Banco de dados"), "Verificar");

    expect(app.attributes("disabled")).toBeUndefined();
    expect(db.attributes("disabled")).toBeDefined();

    await app.trigger("click");
    expect(probe.pwaCheck).toHaveBeenCalledOnce();
  });
});
