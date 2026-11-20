/**
 * Áudio por baixo da foto: abrir um arquivo de áudio com uma foto (ou PDF) na
 * tela não fecha a projeção — o player é do som, a tela é da foto. Um vídeo
 * na tela sai, porque o player é um só.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { KEYS } from "@/constants/UserDataKeys";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const enviado = vi.fn();

vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: (tipo: string, payload?: unknown) => enviado(tipo, payload),
    listen: () => () => {},
    getLastPayload: () => null,
  },
}));

vi.mock("@/helpers/ProjectionWindows", async (original) => ({
  ...(await original<typeof import("@/helpers/ProjectionWindows")>()),
  closeFileProjectionWindows: vi.fn(async () => {}),
  closeMusicProjectionWindows: vi.fn(async () => {}),
  closeProjectionWindows: vi.fn(async () => {}),
  openProjectionWindows: vi.fn(async () => {}),
}));

type Media = typeof import("@/composables/useMedia").default;
let media: Media;

beforeEach(async () => {
  setActivePinia(createPinia());
  media = (await import("@/composables/useMedia")).default;
  enviado.mockClear();
});

const fechou = () => enviado.mock.calls.some(([tipo]) => tipo === BROADCAST_TYPE.MEDIA_CLOSE);

describe("áudio por baixo do que está na tela", () => {
  it("foto na tela: abrir um arquivo de áudio não fecha a projeção", async () => {
    localStorage.setItem(
      KEYS.PROJECTION.LJ_FILE_PROJECTION,
      JSON.stringify({ url: "blob:foto", type: "image" })
    );
    await media
      .openAudio({ url: "blob:musica", title: "musica.mp3", mediaType: "audio" })
      .catch(() => {});
    expect(fechou()).toBe(false);
    expect(localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION)).not.toBeNull();
  });

  it("vídeo na tela: o áudio novo tira o vídeo (o player é um só)", async () => {
    localStorage.setItem(
      KEYS.PROJECTION.LJ_FILE_PROJECTION,
      JSON.stringify({ url: "blob:video", type: "video" })
    );
    await media
      .openAudio({ url: "blob:musica", title: "musica.mp3", mediaType: "audio" })
      .catch(() => {});
    expect(fechou()).toBe(true);
  });
});
