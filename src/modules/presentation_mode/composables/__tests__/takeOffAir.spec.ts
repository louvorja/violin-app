import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  close: vi.fn(),
  send: vi.fn(),
  set: vi.fn(),
  stopProjection: vi.fn(),
}));
vi.mock("@/composables/useMedia", () => ({ default: { close: m.close } }));
vi.mock("@/helpers/Broadcast", () => ({ default: { send: m.send } }));
vi.mock("@/helpers/UserData", () => ({ default: { set: m.set } }));
vi.mock("@/composables/useFileProjection", () => ({ useFileProjection: () => ({ stopProjection: m.stopProjection }) }));

import { takeOffAir } from "../takeOffAir";

beforeEach(() => vi.clearAllMocks());

describe("takeOffAir", () => {
  it.each(["music", "file", "online_video"] as const)("%s sai do ar sem fechar as janelas", (kind) => {
    takeOffAir(kind);
    expect(m.close).toHaveBeenCalledWith(true, false, true);
  });

  it("versículo apaga a Bíblia na tela", () => {
    takeOffAir("bible");
    expect(m.send).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ active: false }));
    expect(m.close).not.toHaveBeenCalled();
  });

  it("anúncios param a projeção deles", () => {
    takeOffAir("announcements");
    expect(m.stopProjection).toHaveBeenCalled();
  });

  it("nada no ar: não faz nada", () => {
    takeOffAir(null);
    expect([m.close, m.send, m.stopProjection].some((f) => f.mock.calls.length)).toBe(false);
  });
});
