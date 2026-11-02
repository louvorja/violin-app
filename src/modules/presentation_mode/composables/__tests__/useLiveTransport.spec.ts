import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const el = { muted: false };
const duration = ref(0);
const currentTime = ref(0);
const isPaused = ref(true);
const volume = ref(80);
vi.mock("@/composables/useAudioPlayback", () => ({
  useAudioPlayback: () => ({ getElement: () => el, duration, currentTime, isPaused, volume }),
}));
const media = vi.hoisted(() => ({
  play: vi.fn(),
  pause: vi.fn(),
  advanceTime: vi.fn(),
  goToTime: vi.fn(),
  setVolume: vi.fn(),
}));
vi.mock("@/composables/useMedia", () => ({ default: media }));
const appAudio = vi.hoisted(() => ({ value: "" }));
vi.mock("@/helpers/AppData", () => ({ default: { get: () => appAudio.value } }));
const file = ref<{ type: string } | null>(null);
vi.mock("../useLiveContent", () => ({ useLiveContent: () => ({ file }) }));

const { useLiveTransport, AUTO_ADVANCE_MS } = await import("../useLiveTransport");
import type { LiveKind } from "../useLiveContent";
import type { PartPosition } from "../useLiveNavigation";

function setup(kind: LiveKind | null, position: PartPosition | null, audioLive = false) {
  const liveKind = ref<LiveKind | null>(kind);
  const pos = ref<PartPosition | null>(position);
  const navigate = vi.fn((to: string) => {
    if (to === "next" && pos.value) pos.value = { ...pos.value, index: pos.value.index + 1 };
  });
  const scope = effectScope();
  const t = scope.run(() =>
    useLiveTransport({
      liveKind,
      audioLive: ref(audioLive),
      position: pos,
      navigate,
      locked: ref(false),
    })
  )!;
  return { t, liveKind, pos, navigate, scope };
}

describe("useLiveTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    file.value = null;
    appAudio.value = "";
  });
  afterEach(() => vi.useRealTimers());

  it("imagem sozinha e música só letra: reproduzir e áudio ficam apagados", () => {
    file.value = { type: "image" };
    expect(setup("file", null).t.canPlay.value).toBe(false);
    const music = setup("music", { unit: "slide", index: 0, total: 5 }).t;
    expect(music.canPlay.value).toBe(false);
    expect(music.hasAudio.value).toBe(false);
  });

  it("vídeo: reproduzir comanda o player e o tempo vale", () => {
    file.value = { type: "video" };
    const { t } = setup("file", null);
    expect(t.timed.value).toBe(true);
    t.togglePlay();
    expect(media.play).toHaveBeenCalled();
    t.seekBy(10);
    expect(media.advanceTime).toHaveBeenCalledWith(10);
  });

  it("PDF: reproduzir passa as páginas sozinho e para na última", async () => {
    file.value = { type: "pdf" };
    const { t, navigate } = setup("file", { unit: "page", index: 0, total: 3 });
    expect(t.canAutoAdvance.value).toBe(true);
    t.togglePlay();
    expect(t.playing.value).toBe(true);
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 4);
    await nextTick();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(t.playing.value).toBe(false);
  });

  it("tirar do ar desliga o passar sozinho", async () => {
    const { t, liveKind } = setup("file", { unit: "file", index: 0, total: 4 });
    t.togglePlay();
    liveKind.value = null;
    await nextTick();
    expect(t.playing.value).toBe(false);
  });

  it("foto com música por baixo: a barra é da foto, e o K e o mudo vão para a música", () => {
    file.value = { type: "image" };
    const { t } = setup("file", null, true);
    expect(t.timed.value).toBe(false);
    expect(t.audioUnder.value).toBe(true);
    expect(t.canPlay.value).toBe(true);
    expect(t.hasAudio.value).toBe(true);
    t.togglePlay();
    expect(media.play).toHaveBeenCalled();
  });

  it("pasta de fotos com música: reproduzir continua sendo passar as fotos", () => {
    file.value = { type: "image" };
    const { t } = setup("file", { unit: "file", index: 0, total: 3 }, true);
    expect(t.canAutoAdvance.value).toBe(true);
    t.togglePlay();
    expect(t.autoAdvancing.value).toBe(true);
    expect(media.play).not.toHaveBeenCalled();
  });

  it("só a música no ar (nada nas telas): a barra segue o tempo dela", () => {
    const { t } = setup(null, null, true);
    expect(t.timed.value).toBe(true);
    expect(t.audioUnder.value).toBe(false);
  });
});
