import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/constants/UserDataKeys";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  send: vi.fn(),
  open: vi.fn(async () => {}),
}));

vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) => mocks.get(key, fallback),
    set: (key: string, value: unknown) => mocks.set(key, value),
  },
}));
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: (type: string, payload: unknown) => mocks.send(type, payload) },
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  openBackgroundProjectionWindows: mocks.open,
}));

import {
  activateBackgroundProjection,
  resolveBackgroundProjectionUrl,
} from "../BackgroundProjectionPlayback";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockReturnValue(false);
  localStorage.clear();
});

describe("BackgroundProjectionPlayback", () => {
  it("ativa a projeção inativa e publica a mídia selecionada", async () => {
    const ok = await activateBackgroundProjection({
      id: "bg-1",
      name: "Fundo do culto",
      path: "blob:fundo",
      type: "image",
    });

    expect(ok).toBe(true);
    expect(mocks.set).toHaveBeenCalledWith(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, true);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(
      BROADCAST_TYPE.BACKGROUND_PROJECTION,
      expect.objectContaining({
        active: true,
        url: "blob:fundo",
        type: "image",
        title: "Fundo do culto",
      })
    );
  });

  it("se já está ativa, troca a mídia sem reabrir as janelas", async () => {
    mocks.get.mockReturnValue(true);

    await activateBackgroundProjection({
      id: "bg-2",
      name: "Outro fundo",
      path: "blob:outro",
      type: "video",
    });

    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith(
      BROADCAST_TYPE.BACKGROUND_PROJECTION,
      expect.objectContaining({ active: true, url: "blob:outro", type: "video" })
    );
  });

  it("não ativa quando o registro não tem caminho nem bytes", async () => {
    const ok = await activateBackgroundProjection({ id: "bg-3", name: "Vazio", type: "image" });

    expect(ok).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("recria a URL a partir dos bytes quando o caminho não é reproduzível", () => {
    const url = resolveBackgroundProjectionUrl({
      id: "bg-4",
      name: "Com bytes",
      path: "",
      data: new Uint8Array([1, 2, 3]).buffer,
      mime: "image/png",
      type: "image",
    });

    expect(url).toMatch(/^blob:/);
    URL.revokeObjectURL(url);
  });
});
