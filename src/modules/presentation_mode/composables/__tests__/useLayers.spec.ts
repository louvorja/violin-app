import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const m = vi.hoisted(() => ({
  close: vi.fn(),
  showOnReturn: vi.fn(async () => {}),
  takeOffAir: vi.fn(),
  appdata: {} as Record<string, unknown>,
}));
const live = { current: ref<string | null>(null), file: ref<{ type: string } | null>(null) };
const returnState = { id: null as string | null };

vi.mock("@/helpers/AppData", () => ({
  default: { get: (key: string, fallback?: unknown) => m.appdata[key] ?? fallback },
}));
vi.mock("@/composables/useMedia", () => ({ default: { close: m.close } }));
vi.mock("@/composables/useFileProjection", () => ({ useFileProjection: () => ({ stopProjection: vi.fn() }) }));
vi.mock("../useLiveContent", () => ({ useLiveContent: () => live }));
vi.mock("../useReturnPlayer", () => ({ useReturnPlayer: () => ({ state: returnState }) }));
vi.mock("../useOutputs", () => ({ anyScreenOpen: vi.fn(), returnOverride: ref(null), showOnReturn: m.showOnReturn }));
vi.mock("../takeOffAir", () => ({ takeOffAir: m.takeOffAir }));

const { claimScreen, stopAllLayers } = await import("../useLayers");
const { KEYS } = await import("@/constants/UserDataKeys");

beforeEach(() => {
  vi.clearAllMocks();
  live.current.value = null;
  live.file.value = null;
  returnState.id = null;
  m.appdata = {};
});

describe("claimScreen", () => {
  it("foto, PDF ou versículo no lugar de um vídeo param o vídeo", () => {
    live.current.value = "file";
    live.file.value = { type: "video" };
    claimScreen("other");
    expect(m.close).toHaveBeenCalledWith(true, false, true);
  });

  it("sem vídeo na tela, nada para — o \"só áudio\" segue por baixo da foto", () => {
    live.current.value = "file";
    live.file.value = { type: "image" };
    claimScreen("other");
    expect(m.close).not.toHaveBeenCalled();
  });

  it("música troca o player sozinha: a camada não fecha nada", () => {
    live.current.value = "online_video";
    claimScreen("music");
    expect(m.close).not.toHaveBeenCalled();
  });

  it("vídeo novo tira o vídeo que estava só no retorno", () => {
    returnState.id = "r1";
    claimScreen("video");
    expect(m.showOnReturn).toHaveBeenCalledWith(null);
  });
});

describe("stopAllLayers", () => {
  it("um áudio tocando sozinho também está no ar: Tirar do ar o para", () => {
    m.appdata[KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY] = true;
    stopAllLayers();
    expect(m.takeOffAir).not.toHaveBeenCalled();
    expect(m.close).toHaveBeenCalledWith(true, false, true);
  });

  it("foto com música por baixo: sai a foto e sai a música", () => {
    live.current.value = "file";
    m.appdata[KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY] = true;
    stopAllLayers();
    expect(m.takeOffAir).toHaveBeenCalledWith("file");
    expect(m.close).toHaveBeenCalledWith(true, false, true);
  });
});
