import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import StartupCheckDialog from "@/components/StartupCheckDialog.vue";
import { useSyncManager } from "@/composables/useSyncManager";

const h = vi.hoisted(() => ({
  ensureCatalog: vi.fn(),
  downloadBundle: vi.fn(),
  runScan: vi.fn(),
  checkFtp: vi.fn(),
}));

vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback: unknown) => fallback },
}));
vi.mock("@/composables/useSyncManager", async () => {
  const { ref, computed } = await import("vue");
  const bundleProgress = ref({ phase: "download", current: 0, total: 100 });
  const sync = {
    ensureCatalogBundle: h.ensureCatalog,
    downloadBundle: h.downloadBundle,
    runScan: h.runScan,
    checkFtp: h.checkFtp,
    bundleInstalling: ref(false),
    bundleProgress,
    bundlePercent: computed(() => bundleProgress.value.current),
    scanProgress: ref({ done: 0, total: 0 }),
    ftpChecking: ref(false),
    ftpOk: ref(true),
    downloading: ref(false),
    bibleDownloading: ref(false),
  };
  return { useSyncManager: () => sync, CatalogIncompleteError: class extends Error {} };
});
vi.mock("@/composables/useBackgroundTasks", async () => {
  const { ref } = await import("vue");
  return { useBackgroundTasks: () => ({ tasks: ref([]) }) };
});

const sync = useSyncManager();
const dialogs: { unmount: () => void }[] = [];

function openDialog() {
  const dialog = mountUi(StartupCheckDialog, {
    attachTo: document.body,
    props: { modelValue: true },
    global: { stubs: { DontShowAgainCheckbox: true } },
  });
  dialogs.push(dialog);
  return dialog;
}

function scanResult(catalogAvailable = true, detailed = false) {
  return {
    catalogAvailable,
    detailed,
    categories: [],
    hymnalIds: [],
    cachedAlbums: new Set(),
    classicAlbums: new Set(),
    hymnalCached: false,
    bibleVersions: [],
    downloadedBibles: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.ensureCatalog.mockResolvedValue(true);
  h.runScan.mockResolvedValue(scanResult());
  h.downloadBundle.mockResolvedValue(true);
  sync.bundleInstalling.value = false;
  sync.bundleProgress.value.current = 0;
});

afterEach(() => {
  for (const dialog of dialogs.splice(0)) dialog.unmount();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("catálogo na Verificação Inicial", () => {
  it("instala sem clique e aguarda o download antes de exibir o resumo", async () => {
    let finish!: (_installed: boolean) => void;
    h.ensureCatalog.mockImplementation(() => new Promise<boolean>((resolve) => (finish = resolve)));
    sync.bundleInstalling.value = true;
    sync.bundleProgress.value.current = 42;

    openDialog();
    await flushPromises();

    expect(h.ensureCatalog).toHaveBeenCalledOnce();
    expect(h.runScan).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Baixando banco de dados...");
    expect(document.body.textContent).toContain("42%");
    expect(document.body.textContent).not.toContain("Instalar catálogo");

    sync.bundleInstalling.value = false;
    finish(true);
    await flushPromises();

    expect(h.runScan).toHaveBeenCalledWith("pt", { detailed: false });
    expect(document.body.textContent).toContain("O banco de dados está pronto.");
    expect(document.body.textContent).toContain("Verificar arquivos");
    expect(document.body.textContent).toContain("Baixar os áudios é opcional");
    expect(h.downloadBundle).not.toHaveBeenCalled();
  });

  it("uma falha libera o app e permite repetir o download explicitamente", async () => {
    h.ensureCatalog.mockResolvedValue(false);
    h.runScan.mockResolvedValueOnce(scanResult(false)).mockResolvedValue(scanResult(true, true));
    const dialog = openDialog();
    await flushPromises();

    expect(document.body.textContent).toContain("Não foi possível baixar o banco de dados");
    expect(document.body.textContent).not.toContain("instale o catálogo somente se quiser");
    const buttons = Array.from(document.body.querySelectorAll("button"));
    expect(
      buttons.some((button) => button.textContent?.includes("Fechar") && !button.disabled)
    ).toBe(true);
    buttons.find((button) => button.textContent?.includes("Tentar de novo"))!.click();
    await flushPromises();

    expect(h.downloadBundle).toHaveBeenCalledWith({ catalogOnly: true });
    expect(h.runScan).toHaveBeenLastCalledWith("pt", { detailed: true });
    expect(h.ensureCatalog).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Não foi possível baixar o banco de dados");
    expect(dialog.emitted("update:modelValue")).toBeUndefined();
  });

  it("uma falha na leitura do armazenamento não prende a tela na verificação", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.ensureCatalog.mockRejectedValue(new Error("IndexedDB indisponível"));
    openDialog();
    await flushPromises();

    expect(h.runScan).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Não foi possível baixar o banco de dados");
    expect(document.body.textContent).toContain("Tentar de novo");
  });
});
