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
  collectFiles: vi.fn(),
  startDownloads: vi.fn(),
  waitForDownloadQueue: vi.fn(),
  downloadBibleVersions: vi.fn(),
  cancelBundle: vi.fn(),
  cancelDownloads: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/helpers/ReliabilityDiagnostics", () => ({
  reportReliabilityEvent: h.track,
  reportReliabilityFailure: vi.fn(),
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
    collectFiles: h.collectFiles,
    startDownloads: h.startDownloads,
    waitForDownloadQueue: h.waitForDownloadQueue,
    downloadBibleVersions: h.downloadBibleVersions,
    cancelBundle: h.cancelBundle,
    cancelDownloads: h.cancelDownloads,
    downloadProgress: ref({ done: 0, failed: 0, total: 0, currentFile: "" }),
    bibleProgress: ref({ done: 0, total: 0, currentFile: "" }),
    downloadCompletedMsg: ref(""),
    bibleCompletedMsg: ref(""),
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
  sync.downloading.value = false;
  sync.bibleDownloading.value = false;
  sync.downloadProgress.value = { done: 0, failed: 0, total: 0, currentFile: "" };
  sync.downloadCompletedMsg.value = "";
  sync.bibleCompletedMsg.value = "";
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

describe("telemetria da Verificação Inicial", () => {
  function tracked(name: string) {
    return h.track.mock.calls.filter(([event]) => event === name).map(([, props]) => props);
  }

  it("registra a abertura, o fim da verificação e o fechamento pelo botão", async () => {
    window.localStorage.clear();
    openDialog();
    await flushPromises();

    expect(tracked("startup_check_opened")).toEqual([expect.objectContaining({ source: "boot" })]);
    expect(tracked("startup_check_scan_finished")).toEqual([
      expect.objectContaining({ outcome: "ok", detailed: false }),
    ]);

    Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Fechar") && !button.disabled)!
      .click();
    await flushPromises();

    expect(tracked("startup_check_closed")).toEqual([
      expect.objectContaining({ via: "close_button", view: "summary", scan_outcome: "ok" }),
    ]);
  });

  it("verificação que falha também conta como terminada, com o desfecho", async () => {
    window.localStorage.clear();
    h.runScan.mockRejectedValue(new Error("leitura falhou"));
    openDialog();
    await flushPromises();

    expect(tracked("startup_check_scan_finished")).toEqual([
      expect.objectContaining({ outcome: "failed" }),
    ]);
  });
});

/** Resumo detalhado: uma categoria com dois álbuns e uma versão da Bíblia. */
function detailedResult(cached: number[] = []) {
  return {
    ...scanResult(true, true),
    categories: [
      {
        id_category: 1,
        name: "CDs Oficiais/Ano",
        albums: [
          { id_album: 10, name: "Somos a Igreja" },
          { id_album: 11, name: "Meu Lugar no Mundo" },
        ],
      },
    ],
    cachedAlbums: new Set(cached),
    bibleVersions: [{ id_bible_version: 1, name: "Almeida Corrigida Fiel", abbreviation: "ACF" }],
  };
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label)
  );
}

/** Abre o diálogo já no resumo detalhado, como depois de "Verificar arquivos". */
async function openDetailedSummary() {
  h.runScan.mockResolvedValueOnce(scanResult()).mockResolvedValue(detailedResult());
  const dialog = openDialog();
  await flushPromises();
  button("Verificar arquivos")!.click();
  await flushPromises();
  expect(document.body.textContent).toContain("0/2");
  return dialog;
}

describe("download pela Verificação Inicial", () => {
  it("ao terminar mostra a conclusão e Fechar, não o resumo de antes do download", async () => {
    let finishQueue!: () => void;
    h.collectFiles.mockResolvedValue([{ remote: "a.opus" }, { remote: "b.opus" }]);
    h.startDownloads.mockImplementation(async () => {
      sync.downloading.value = true;
      sync.downloadProgress.value = { done: 0, failed: 0, total: 2, currentFile: "" };
    });
    h.waitForDownloadQueue.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishQueue = () => {
            sync.downloading.value = false;
            sync.downloadProgress.value = { done: 2, failed: 0, total: 2, currentFile: "" };
            resolve();
          };
        })
    );
    h.downloadBibleVersions.mockResolvedValue(1);
    const dialog = await openDetailedSummary();

    button("Baixar Tudo")!.click();
    await flushPromises();
    expect(document.body.textContent).toContain("0 de 2 (0%)");
    expect(document.body.textContent).not.toContain("Concluído");

    finishQueue();
    await flushPromises();

    expect(h.downloadBibleVersions).toHaveBeenCalledWith([1], expect.any(Array), "pt");
    expect(document.body.textContent).toContain("Concluído: 2 baixados, 0 falharam.");
    expect(document.body.textContent).not.toContain("Baixar Tudo");
    expect(document.body.textContent).not.toContain("0/2");
    expect(button("Cancelar Download")).toBeUndefined();

    button("Fechar")!.click();
    expect(dialog.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("não anuncia a conclusão enquanto a lista de arquivos ainda está sendo montada", async () => {
    let collected!: (_files: unknown[]) => void;
    h.collectFiles.mockImplementation(() => new Promise((resolve) => (collected = resolve)));
    await openDetailedSummary();

    button("Baixar Tudo")!.click();
    await flushPromises();

    expect(document.body.textContent).toContain("Preparando os downloads...");
    expect(document.body.textContent).not.toContain("Downloads concluídos.");
    expect(button("Cancelar Download")).toBeDefined();

    collected([]);
    await flushPromises();

    expect(document.body.textContent).toContain("Downloads concluídos.");
    expect(document.body.textContent).not.toContain("Preparando os downloads...");
  });

  it("cancelar nas coletâneas não começa a Bíblia e volta ao resumo atualizado", async () => {
    let finishQueue!: () => void;
    h.collectFiles.mockResolvedValue([{ remote: "a.opus" }, { remote: "b.opus" }]);
    h.startDownloads.mockImplementation(async () => {
      sync.downloading.value = true;
      sync.downloadProgress.value = { done: 1, failed: 0, total: 2, currentFile: "" };
    });
    h.waitForDownloadQueue.mockImplementation(
      () => new Promise<void>((resolve) => (finishQueue = resolve))
    );
    h.cancelDownloads.mockImplementation(() => {
      sync.downloading.value = false;
      finishQueue();
    });
    const dialog = await openDetailedSummary();
    h.runScan.mockResolvedValue(detailedResult([10]));

    button("Baixar Tudo")!.click();
    await flushPromises();
    button("Cancelar Download")!.click();
    await flushPromises();

    expect(h.downloadBibleVersions).not.toHaveBeenCalled();
    expect(h.runScan).toHaveBeenLastCalledWith("pt", { detailed: true });
    expect(document.body.textContent).toContain("1/2");
    expect(document.body.textContent).toContain("Baixar Tudo");
    expect(dialog.emitted("update:modelValue")).toBeUndefined();
  });
});
