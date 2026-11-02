// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import Module from "node:module";

const require = createRequire(import.meta.url);
const { newerCopy } = require("../windowsInstallCopies.js");

const ORIGINAL_LOAD = Module._load;
Module._load = function (request, ...args) {
  if (request === "electron") return { app: { getVersion: () => "0.0.0" } };
  if (request === "electron-updater") return { autoUpdater: {}, CancellationToken: class {} };
  return ORIGINAL_LOAD.call(this, request, ...args);
};
const { compareVersions } = require("../updater.js");
Module._load = ORIGINAL_LOAD;
afterAll(() => { delete require.cache[require.resolve("../updater.js")]; });

const env = {
  LOCALAPPDATA: "C:\\Users\\op\\AppData\\Local",
  ProgramW6432: "C:\\Program Files",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
};
const BOOT = "C:\\Users\\op\\AppData\\Roaming\\LouvorJA Violin";
const REGISTRY = `${BOOT}\\installations.json`;
const USER = "C:\\Users\\op\\AppData\\Local\\Programs\\LouvorJA Violin\\LouvorJA Violin.exe";
const MACHINE = "C:\\Program Files\\LouvorJA Violin\\LouvorJA Violin.exe";

/** Sistema de arquivos em caminhos do Windows: { exe: versão } instala uma cópia. */
function windows(copies = {}, files = {}) {
  const store = new Map(Object.entries(files));
  for (const [exe, version] of Object.entries(copies)) {
    const dir = exe.slice(0, exe.lastIndexOf("\\"));
    store.set(exe, "MZ");
    store.set(`${dir}\\resources\\app.asar\\package.json`, JSON.stringify({ version }));
  }
  const missing = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return {
    store,
    readFileSync(file) { if (!store.has(file)) throw missing(); return store.get(file); },
    statSync(file) { if (!store.has(file)) throw missing(); return { isFile: () => true }; },
    mkdirSync() {},
    writeFileSync(file, data) { store.set(file, data); },
  };
}
const pick = (execPath, version, fsImpl) => newerCopy({
  execPath, version, bootstrap: BOOT, compareVersions, platform: "win32", env, fsImpl,
});

describe("cópia só para mim e para todos na mesma conta", () => {
  it("a cópia para todos parada numa versão antiga abre a da conta, que já se atualizou", () => {
    const fsImpl = windows({ [USER]: "1.0.0-beta.20", [MACHINE]: "1.0.0-beta.18" });
    expect(pick(MACHINE, "1.0.0-beta.18", fsImpl)).toBe(USER);
    expect(pick(USER, "1.0.0-beta.20", fsImpl)).toBeNull();
  });

  it("quando o administrador atualiza a cópia para todos, a da conta cede a vez", () => {
    const fsImpl = windows({ [USER]: "1.0.0-beta.9", [MACHINE]: "1.0.0-beta.18" });
    expect(pick(USER, "1.0.0-beta.9", fsImpl)).toBe(MACHINE);
    expect(pick(MACHINE, "1.0.0-beta.18", fsImpl)).toBeNull();
  });

  it("na mesma versão fica a que se atualiza sem UAC, e as duas concordam", () => {
    const fsImpl = windows({ [USER]: "1.0.0", [MACHINE]: "1.0.0" });
    expect(pick(MACHINE, "1.0.0", fsImpl)).toBe(USER);
    expect(pick(USER, "1.0.0", fsImpl)).toBeNull();
  });

  it("acha a cópia em pasta escolhida pelo registro de quem já abriu", () => {
    const custom = "D:\\Apps\\LouvorJA\\LouvorJA Violin.exe";
    const fsImpl = windows({ [custom]: "2.0.0", [MACHINE]: "1.0.0" }, {
      [REGISTRY]: JSON.stringify({ version: 1, copies: [custom] }),
    });
    expect(pick(MACHINE, "1.0.0", fsImpl)).toBe(custom);
  });

  it("registra as cópias encontradas e esquece a que foi desinstalada", () => {
    const gone = "D:\\Antiga\\LouvorJA Violin.exe";
    const fsImpl = windows({ [MACHINE]: "1.0.0" }, { [REGISTRY]: JSON.stringify({ version: 1, copies: [gone] }) });
    expect(pick(USER, "1.0.0", fsImpl)).toBeNull();
    expect(JSON.parse(fsImpl.store.get(REGISTRY)).copies).toEqual([USER, MACHINE]);
  });

  it("cópia sem versão legível não ganha a vez", () => {
    const fsImpl = windows({ [MACHINE]: "1.0.0" });
    fsImpl.store.set("C:\\Program Files\\LouvorJA Violin\\resources\\app.asar\\package.json", "{corrompido");
    expect(pick(USER, "1.0.0-beta.1", fsImpl)).toBeNull();
  });

  it("uma cópia só, ou fora do Windows, não muda nada", () => {
    expect(pick(USER, "1.0.0", windows({ [USER]: "1.0.0" }))).toBeNull();
    expect(newerCopy({ execPath: "/Applications/LouvorJA Violin.app", version: "1.0.0", bootstrap: "/tmp", compareVersions, platform: "darwin" })).toBeNull();
  });
});
