// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const monitorConfig = require("../monitorConfig.js");
const LAPTOP = {
  id: 1, label: "Laptop", internal: true,
  bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2,
};
const PROJECTOR = {
  id: 2, label: "Projetor", internal: false,
  bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, scaleFactor: 1,
};
const TV = {
  id: 3, label: "TV retorno", internal: false,
  bounds: { x: 3360, y: 0, width: 1920, height: 1080 }, scaleFactor: 1,
};
let connected;
let userData;
let prefs;
let displays;
let saveUserData;
const originals = new Map();

function inject(specifier, exports) {
  const id = require.resolve(specifier);
  originals.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

beforeAll(async () => {
  await require("../monitorIdentityBridge.cjs").init();
});

beforeEach(() => {
  connected = [LAPTOP, PROJECTOR, TV];
  userData = {};
  prefs = { musicas: 2, retorno: 3, operador: 1 };
  monitorConfig.migrateIfNeeded({ userData, prefs, connected });
  saveUserData = vi.fn();
  inject("electron", {
    screen: { getAllDisplays: () => connected, getPrimaryDisplay: () => LAPTOP },
  });
  inject("../userStore.js", {
    read: () => structuredClone(prefs),
    write: async (_key, value) => { prefs = structuredClone(value); },
  });
  delete require.cache[require.resolve("../displays.js")];
  displays = require("../displays.js");
  displays.configure({ getUserData: () => userData, saveUserData, getOperatorDisplay: () => LAPTOP });
});

afterEach(() => {
  delete require.cache[require.resolve("../displays.js")];
  for (const [id, original] of originals) {
    if (original) require.cache[id] = original;
    else delete require.cache[id];
  }
  originals.clear();
});

describe("monitor escolhido no utilitário", () => {
  it("isola Recados sem alterar os papéis globais, músicas ou outros utilitários", async () => {
    const roles = structuredClone(userData.options.displays.roles);
    await displays.setPreferred("message_board", 3);

    expect(displays.getPreferred("message_board")?.id).toBe(3);
    expect(displays.getPreferred("musicas")?.id).toBe(2);
    expect(displays.getPreferred("counter")?.id).toBe(2);
    expect(displays.getPreferred("clock")?.id).toBe(3);
    expect(userData.options.displays.roles).toEqual(roles);
    expect(saveUserData).toHaveBeenCalled();
  });

  it("mantém escolhas independentes em utilitários de projeção e de retorno", async () => {
    await displays.setPreferred("message_board", 3);
    await displays.setPreferred("clock", 1);
    expect(displays.getPreferred("message_board")?.id).toBe(3);
    expect(displays.getPreferred("clock")?.id).toBe(1);
    expect(displays.getPreferred("retorno")?.id).toBe(3);
    expect(displays.getPreferred("musicas")?.id).toBe(2);
    expect(displays.getPrefs()).toEqual({ message_board: 3, clock: 1 });
  });

  it("restaura o padrão atual sem alterar nenhuma atribuição global", async () => {
    await displays.setPreferred("message_board", 3);
    displays.setRole("projection", 1);
    expect(displays.getPreferred("message_board")?.id).toBe(3);
    await displays.setPreferred("message_board", undefined);
    expect(displays.getPreferred("message_board")?.id).toBe(1);
    expect(displays.getPreferred("musicas")?.id).toBe(1);
    expect(displays.getPreferred("retorno")?.id).toBe(3);
    expect(displays.getPrefs()).not.toHaveProperty("message_board");
    expect(prefs).not.toHaveProperty("message_board");
  });

  it("mesma janela fica restrita ao utilitário e pode voltar ao padrão", async () => {
    await displays.setPreferred("message_board", 3);
    await displays.setPreferred("message_board", null);
    expect(displays.getPreferred("message_board")).toBeNull();
    expect(displays.getPrefs()).toEqual({ message_board: null });
    expect(displays.getPreferred("musicas")?.id).toBe(2);
    await displays.setPreferred("message_board", undefined);
    expect(displays.getPreferred("message_board")?.id).toBe(2);
    expect(displays.getPrefs()).not.toHaveProperty("message_board");
  });

  it("selecionar um papel nas opções substitui a escolha individual", async () => {
    await displays.setPreferred("message_board", 3);
    displays.setFeatureRole("message_board", "projection");
    expect(displays.getPreferred("message_board")?.id).toBe(2);
    expect(displays.getPreferred("retorno")?.id).toBe(3);
  });

  it("preserva a escolha após recarregar os dados sem remigrar os papéis", async () => {
    await displays.setPreferred("message_board", 3);
    userData = JSON.parse(JSON.stringify(userData));
    expect(monitorConfig.migrateIfNeeded({ userData, prefs, connected }).changed).toBe(false);
    expect(displays.getPreferred("message_board")?.id).toBe(3);
    expect(displays.getPreferred("musicas")?.id).toBe(2);
  });

  it("reconhece o monitor escolhido quando o sistema muda seu id", async () => {
    await displays.setPreferred("message_board", 3);
    connected = [LAPTOP, PROJECTOR, { ...TV, id: 30 }];
    expect(displays.getPreferred("message_board")?.id).toBe(30);
    expect(displays.getPrefs()).toEqual({ message_board: 30 });
    expect(displays.getPreferred("musicas")?.id).toBe(2);
  });

  it("não usa o projetor global quando o monitor escolhido está ausente", async () => {
    await displays.setPreferred("message_board", 3);
    connected = [LAPTOP, PROJECTOR];
    expect(displays.resolveFeature("message_board")).toMatchObject({
      status: "pending", display: null, reason: "monitor-absent",
    });
    expect(displays.getPrefs()).toEqual({ message_board: null });
    expect(displays.getPreferred("musicas")?.id).toBe(2);
  });

  it("ignora monitores inexistentes sem perder a configuração anterior", async () => {
    await displays.setPreferred("message_board", 3);
    const before = structuredClone(userData);
    expect(await displays.setPreferred("message_board", 999)).toBe(false);
    expect(userData).toEqual(before);
    expect(displays.getPreferred("message_board")?.id).toBe(3);
  });

  it("recusa uma identidade persistida inválida sem projetar em outra tela", async () => {
    await displays.setPreferred("message_board", 3);
    userData.options.displays.feature_displays.message_board.identity = { source: "electron" };
    expect(displays.resolveFeature("message_board")).toMatchObject({
      status: "pending", display: null, reason: "invalid-monitor",
    });
    expect(displays.getPreferred("musicas")?.id).toBe(2);
  });
});
