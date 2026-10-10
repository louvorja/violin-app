// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const userStore = require("../userStore.js");
const devices = require("../devices.js");

// userStore em memória — `devices.js` usa o MESMO objeto (cache CJS), então
// espiar aqui alcança as chamadas de lá. Nada é gravado no disco.
beforeAll(() => {
  vi.spyOn(userStore, "read").mockReturnValue(null);
  vi.spyOn(userStore, "write").mockResolvedValue(undefined);
});

afterAll(() => vi.restoreAllMocks());

describe("devices — chat_history_limit", () => {
  it("usa 100 como padrão quando não há nada salvo", () => {
    expect(devices.getSettings().chat_history_limit).toBe(100);
    expect(devices.getChatHistoryLimit()).toBe(100);
  });

  it("faz clamp entre 1 e 500", () => {
    expect(devices.updateSettings({ chat_history_limit: 9999 }).chat_history_limit).toBe(500);
    expect(devices.updateSettings({ chat_history_limit: 0 }).chat_history_limit).toBe(1);
    expect(devices.updateSettings({ chat_history_limit: -5 }).chat_history_limit).toBe(1);
    expect(devices.updateSettings({ chat_history_limit: "abc" }).chat_history_limit).toBe(100);
    expect(devices.updateSettings({ chat_history_limit: 250 }).chat_history_limit).toBe(250);
  });

  it("patch parcial preserva o outro campo", () => {
    devices.updateSettings({ only_authorized_devices: true });
    devices.updateSettings({ chat_history_limit: 42 });
    expect(devices.getSettings()).toEqual({
      only_authorized_devices: true,
      chat_history_limit: 42,
    });
  });
});
