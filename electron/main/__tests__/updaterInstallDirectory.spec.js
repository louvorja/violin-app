// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import Module from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const modulePath = require.resolve("../updater.js");
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalExecPath = Object.getOwnPropertyDescriptor(process, "execPath");
const originalLoad = Module._load;

afterEach(() => {
  Object.defineProperty(process, "platform", originalPlatform);
  Object.defineProperty(process, "execPath", originalExecPath);
  Module._load = originalLoad;
  delete require.cache[modulePath];
});

async function initialize(platform, executable) {
  const nativeUpdater = new EventEmitter();
  nativeUpdater.isUpdaterActive = () => false;
  // NsisUpdater.installDirectory is the supported /D= override, consumed when
  // launching the installer, including when elevate.exe runs another account.
  Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
  Object.defineProperty(process, "execPath", { ...originalExecPath, value: executable });
  Module._load = function (request, ...args) {
    if (request === "electron") return { app: { getVersion: () => "1.0.0" } };
    if (request === "electron-updater") return { autoUpdater: nativeUpdater, CancellationToken: class {} };
    if (request === "https") {
      return {
        get: (_url, _opts, callback) => {
          const req = new EventEmitter();
          req.setTimeout = () => {};
          req.destroy = () => {};
          setImmediate(() => {
            const res = new EventEmitter();
            res.statusCode = 200;
            res.headers = {};
            callback(res);
            res.emit("data", Buffer.from("[]"));
            res.emit("end");
          });
          return req;
        },
      };
    }
    return originalLoad.call(this, request, ...args);
  };
  delete require.cache[modulePath];
  const updater = require(modulePath);
  updater.init({ autoCheck: false });
  // O electron-updater só é carregado e configurado na primeira verificação.
  await updater.checkForUpdates();
  return nativeUpdater;
}

describe("updater preserves Windows installation directory", () => {
  it.each([
    ["C:\\Program Files\\LouvorJA antigo\\LouvorJA Violin.exe", "C:\\Program Files\\LouvorJA antigo"],
    ["D:\\Aplicativos da igreja\\LouvorJA Violin.exe", "D:\\Aplicativos da igreja"],
    ["C:\\Users\\João\\Apps\\LouvorJA Violin.exe", "C:\\Users\\João\\Apps"],
  ])("updates %s in place after elevation", async (executable, directory) => {
    expect((await initialize("win32", executable)).installDirectory).toBe(directory);
  });

  it("does not apply the NSIS override to macOS", async () => {
    expect((await initialize("darwin", "/Applications/LouvorJA Violin.app/Contents/MacOS/LouvorJA Violin")).installDirectory).toBeUndefined();
  });
});

describe("updater stays out of the window creation path", () => {
  it("only loads electron-updater on the first check", async () => {
    let loads = 0;
    const nativeUpdater = new EventEmitter();
    nativeUpdater.isUpdaterActive = () => true;
    nativeUpdater.setFeedURL = () => {};
    nativeUpdater.checkForUpdates = async () => {};
    Module._load = function (request, ...args) {
      if (request === "electron") return { app: { getVersion: () => "1.0.0" } };
      if (request === "electron-updater") {
        loads += 1;
        return { autoUpdater: nativeUpdater, CancellationToken: class {} };
      }
      if (request === "https") {
        return {
          get: () => {
            const req = new EventEmitter();
            req.setTimeout = () => {};
            req.destroy = () => {};
            setImmediate(() => req.emit("error", new Error("offline")));
            return req;
          },
        };
      }
      return originalLoad.call(this, request, ...args);
    };
    delete require.cache[modulePath];
    const updater = require(modulePath);

    updater.init({ autoCheck: false, useBeta: true });
    updater.setOptions({ autoDownload: false });
    expect(updater.status()).toMatchObject({ status: "idle", version: "1.0.0", useBeta: true });
    expect(loads).toBe(0);

    await updater.checkForUpdates();
    await updater.checkForUpdates();
    expect(loads).toBe(1);
    expect(nativeUpdater.allowPrerelease).toBe(true);
  });
});
