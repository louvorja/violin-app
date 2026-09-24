// @vitest-environment node
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import Module from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const updaterPath = require.resolve("../updater.js");
let originalLoad = null;

function loadUpdater() {
  const nativeUpdater = new EventEmitter();
  nativeUpdater.isUpdaterActive = () => true;
  nativeUpdater.checkForUpdates = vi.fn(async () => {
    nativeUpdater.emit("update-available", { version: "9.0.0", releaseNotes: "" });
  });
  nativeUpdater.downloadUpdate = vi.fn(async () => {
    nativeUpdater.emit("download-progress", { percent: 100 });
    nativeUpdater.emit("update-downloaded", { version: "9.0.0" });
  });
  nativeUpdater.cancelDownload = vi.fn();

  originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === "electron") return { app: { getVersion: () => "1.0.0" } };
    if (request === "electron-updater") return { autoUpdater: nativeUpdater };
    return originalLoad.call(this, request, ...args);
  };
  delete require.cache[updaterPath];
  return { updater: require(updaterPath), nativeUpdater };
}

afterEach(() => {
  if (originalLoad) Module._load = originalLoad;
  originalLoad = null;
  delete require.cache[updaterPath];
  vi.restoreAllMocks();
});

describe("updater admission during presentation", () => {
  it("adia download automático novo e o inicia uma vez ao terminar a apresentação", async () => {
    const { updater, nativeUpdater } = loadUpdater();
    updater.init({ autoCheck: false, autoDownload: true });
    updater.setPresentationActive(true);

    await updater.checkForUpdates();
    expect(nativeUpdater.autoDownload).toBe(false);
    expect(updater.status().status).toBe("available");
    expect(nativeUpdater.downloadUpdate).not.toHaveBeenCalled();

    updater.setPresentationActive(false);
    await vi.waitFor(() => expect(nativeUpdater.downloadUpdate).toHaveBeenCalledTimes(1));
    expect(nativeUpdater.autoDownload).toBe(false);
    expect(updater.status().status).toBe("downloaded");
  });

  it("permite download solicitado pelo operador durante apresentação", async () => {
    const { updater, nativeUpdater } = loadUpdater();
    updater.init({ autoCheck: false, autoDownload: false });
    updater.setPresentationActive(true);
    await updater.checkForUpdates();

    expect(await updater.downloadUpdate()).toMatchObject({ ok: true });
    expect(nativeUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(nativeUpdater.autoDownload).toBe(false);
  });

  it("não cancela um download já iniciado quando a apresentação começa", async () => {
    const { updater, nativeUpdater } = loadUpdater();
    let finishDownload;
    nativeUpdater.downloadUpdate = vi.fn(() => new Promise((resolve) => {
      finishDownload = () => {
        nativeUpdater.emit("update-downloaded", { version: "9.0.0" });
        resolve();
      };
    }));
    updater.init({ autoCheck: false, autoDownload: true });
    await updater.checkForUpdates();
    await vi.waitFor(() => expect(nativeUpdater.downloadUpdate).toHaveBeenCalledTimes(1));

    updater.setPresentationActive(true);
    expect(nativeUpdater.cancelDownload).not.toHaveBeenCalled();
    finishDownload();
    await vi.waitFor(() => expect(updater.status().status).toBe("downloaded"));
  });

  it("não retoma automaticamente um download cancelado pelo operador", async () => {
    const { updater, nativeUpdater } = loadUpdater();
    updater.init({ autoCheck: false, autoDownload: true });
    updater.setPresentationActive(true);
    await updater.checkForUpdates();
    updater.cancelDownload();
    updater.setPresentationActive(false);
    await Promise.resolve();

    expect(nativeUpdater.downloadUpdate).not.toHaveBeenCalled();
  });
});
