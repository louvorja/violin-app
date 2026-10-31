// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module, { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let root, paths, locations, bootstrap;

beforeEach(() => {
  vi.stubEnv("LJ_E2E_USER_DATA", "");
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-paths-data-"));
  bootstrap = path.join(root, "appData", "LouvorJA Violin");
  locations = { appData: path.join(root, "appData"), userData: bootstrap, documents: path.join(root, "Documents") };
  const electron = { app: {
    getPath: (name) => locations[name],
    setPath: (name, value) => { locations[name] = value; },
  } };
  const original = Module._load;
  Module._load = function (request, ...args) { return request === "electron" ? electron : original.call(this, request, ...args); };
  try {
    delete require.cache[require.resolve("../paths.js")];
    paths = require("../paths.js");
  } finally { Module._load = original; }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete require.cache[require.resolve("../paths.js")];
  fs.removeSync(root);
});

describe("raiz única para todos os dados", () => {
  it("centraliza perfil, vídeos e cache em Documentos mantendo só a âncora no endereço do sistema", () => {
    fs.outputFileSync(path.join(bootstrap, "IndexedDB", "offline"), "saved");
    const dataDir = path.join(locations.documents, "LouvorJA Violin");
    expect(paths.dataDir()).toBe(dataDir);
    expect(paths.videosDir()).toBe(path.join(dataDir, "Videos"));
    expect(paths.jsonCacheDir()).toBe(path.join(dataDir, "json_db"));
    paths.configureProfile();
    expect(locations.userData).toBe(path.join(dataDir, ".electron"));
    expect(locations.sessionData).toBe(locations.userData);
    expect(locations.logs).toBe(path.join(locations.userData, "logs"));
    expect(fs.readFileSync(path.join(locations.userData, "IndexedDB", "offline"), "utf8")).toBe("saved");
    expect(fs.readJsonSync(path.join(bootstrap, "data-location.json"))).toEqual({ dataDir });
    expect(paths.profileRestartRequired()).toBe(false);
  });

  it("respeita a pasta escolhida e conclui a mudança do perfil somente na próxima inicialização", () => {
    paths.configureProfile();
    const oldProfile = locations.userData;
    fs.outputFileSync(path.join(oldProfile, "IndexedDB", "offline"), "saved");
    const chosen = path.join(root, "Chosen folder");
    paths.setDataDir(chosen, { moveExisting: true });
    expect(paths.videosDir()).toBe(path.join(chosen, "Videos"));
    expect(paths.jsonCacheDir()).toBe(path.join(chosen, "json_db"));
    expect(paths.profileRestartRequired()).toBe(true);
    expect(fs.readJsonSync(path.join(bootstrap, "data-location.json"))).toEqual({ dataDir: chosen, profileSource: oldProfile });
    paths.configureProfile();
    expect(locations.userData).toBe(path.join(chosen, ".electron"));
    expect(fs.readFileSync(path.join(locations.userData, "IndexedDB", "offline"), "utf8")).toBe("saved");
    expect(paths.profileRestartRequired()).toBe(false);
    expect(fs.pathExistsSync(oldProfile)).toBe(false);
  });

  it("mantém o pedido de mudança na âncora quando o perfil não consegue mudar de lugar", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    paths.configureProfile();
    const oldProfile = locations.userData;
    fs.outputFileSync(path.join(oldProfile, "IndexedDB", "offline"), "saved");
    const chosen = path.join(root, "Full drive");
    paths.setDataDir(chosen, { moveExisting: true });
    const anchor = { dataDir: chosen, profileSource: oldProfile };
    const move = fs.moveSync;
    const spy = vi.spyOn(fs, "moveSync").mockImplementation(() => {
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    });
    expect(() => paths.configureProfile()).not.toThrow();
    expect(locations.userData).toBe(oldProfile);
    expect(fs.readJsonSync(path.join(bootstrap, "data-location.json"))).toEqual(anchor);
    spy.mockImplementation(move);
    paths.configureProfile();
    expect(locations.userData).toBe(path.join(chosen, ".electron"));
    expect(fs.readFileSync(path.join(locations.userData, "IndexedDB", "offline"), "utf8")).toBe("saved");
    expect(fs.readJsonSync(path.join(bootstrap, "data-location.json"))).toEqual({ dataDir: chosen });
  });

  it("ler a âncora independe do endereço atual do perfil Electron", () => {
    const chosen = path.join(root, "Configured");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: chosen });
    locations.userData = path.join(root, "other-profile");
    expect(paths.dataDir()).toBe(chosen);
  });

  it("preserva a pasta escolhida na âncora quando ela está temporariamente indisponível", () => {
    const chosen = path.join(root, "Disconnected drive");
    fs.outputJsonSync(path.join(bootstrap, "data-location.json"), { dataDir: chosen });
    const ensureDir = fs.ensureDirSync;
    vi.spyOn(fs, "ensureDirSync").mockImplementation((dir) => {
      if (dir === chosen) throw new Error("drive unavailable");
      return ensureDir(dir);
    });
    paths.configureProfile();
    expect(paths.dataDirIssue()).toEqual({ wanted: chosen, reason: "not-writable" });
    expect(fs.readJsonSync(path.join(bootstrap, "data-location.json"))).toEqual({ dataDir: chosen });
  });
});
