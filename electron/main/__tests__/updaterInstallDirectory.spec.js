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

function initialize(platform, executable) {
  const nativeUpdater = new EventEmitter();
  // NsisUpdater.installDirectory is the supported /D= override, consumed when
  // launching the installer, including when elevate.exe runs another account.
  Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
  Object.defineProperty(process, "execPath", { ...originalExecPath, value: executable });
  Module._load = function (request, ...args) {
    if (request === "electron") return { app: { getVersion: () => "1.0.0" } };
    if (request === "electron-updater") return { autoUpdater: nativeUpdater, CancellationToken: class {} };
    return originalLoad.call(this, request, ...args);
  };
  delete require.cache[modulePath];
  require(modulePath).init({ autoCheck: false });
  return nativeUpdater;
}

describe("updater preserves Windows installation directory", () => {
  it.each([
    ["C:\\Program Files\\LouvorJA antigo\\LouvorJA Violin.exe", "C:\\Program Files\\LouvorJA antigo"],
    ["D:\\Aplicativos da igreja\\LouvorJA Violin.exe", "D:\\Aplicativos da igreja"],
    ["C:\\Users\\João\\Apps\\LouvorJA Violin.exe", "C:\\Users\\João\\Apps"],
  ])("updates %s in place after elevation", (executable, directory) => {
    expect(initialize("win32", executable).installDirectory).toBe(directory);
  });

  it("does not apply the NSIS override to macOS", () => {
    expect(initialize("darwin", "/Applications/LouvorJA Violin.app/Contents/MacOS/LouvorJA Violin").installDirectory).toBeUndefined();
  });
});
