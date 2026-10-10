import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUserDataStore } from "@/stores/userDataStore";
const platform = vi.hoisted(() => ({ isDesktop: false }));
vi.mock("@/helpers/Platform", () => ({ default: platform }));
vi.mock("@/helpers/Dev", () => ({ default: { write: vi.fn() } }));
vi.mock("@/helpers/Broadcast", () => ({ default: { send: vi.fn() } }));
import UserData from "../UserData";
import Storage from "../Storage";

describe("save pendente antes da recarga PWA", () => {
  beforeEach(() => {
    platform.isDesktop = false;
    setActivePinia(createPinia());
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("persiste a preferência mais recente sem esperar os 300 ms e elimina o timer antigo", async () => {
    const store = useUserDataStore();
    store.theme = "light";
    UserData.save();
    store.theme = "dark";
    UserData.save();
    expect(localStorage.getItem("user_data")).toBeNull();
    UserData.flushPendingWebSave();
    expect(JSON.parse(localStorage.getItem("user_data")!).theme).toBe("dark");
    const write = vi.spyOn(Storage, "set");
    await vi.advanceTimersByTimeAsync(300);
    expect(write).not.toHaveBeenCalled();
  });

  it("preserva a autoridade IPC do desktop sem enviar snapshot pelo flush web", () => {
    platform.isDesktop = true;
    const write = vi.spyOn(Storage, "set");
    const cache = vi.spyOn(Storage, "setLocalCache");
    UserData.save();
    UserData.flushPendingWebSave();
    expect(cache).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it("mantém o save pendente após falha e persiste na segunda tentativa", () => {
    const store = useUserDataStore();
    store.theme = "dark";
    UserData.save();
    const write = vi.spyOn(Storage, "set").mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => UserData.flushPendingWebSave()).toThrow("quota");
    expect(localStorage.getItem("user_data")).toBeNull();
    UserData.flushPendingWebSave();
    expect(JSON.parse(localStorage.getItem("user_data")!).theme).toBe("dark");
    UserData.flushPendingWebSave();
    expect(write).toHaveBeenCalledTimes(2);
  });
});
