import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const h = vi.hoisted(() => ({
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  send: vi.fn(() => ({ crossWindow: true })),
  idb: vi.fn(),
  api: vi.fn(),
  heicToJpeg: vi.fn(),
}));

vi.mock("@/composables/useProjectionCloseNotice", () => ({
  useProjectionCloseNotice: vi.fn(),
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: {
    log: vi.fn(),
    track: vi.fn(),
    histogram: vi.fn(),
    exception: vi.fn(),
    setRuntimeContext: vi.fn(),
  },
}));
vi.mock("@/helpers/PdfRuntime", () => ({
  loadPdfDocument: vi.fn(async () => null),
}));
vi.mock("@/composables/useYouTubeApi", () => ({
  loadYtApi: vi.fn(async () => null),
}));
vi.mock("@/helpers/SettingsStorage", () => ({
  getSetting: vi.fn(async () => null),
}));
vi.mock("@/views/LibrasOverlay.vue", () => ({
  default: { name: "LibrasOverlay", template: "<div class='libras-overlay' />" },
}));
vi.mock("@/components/OverlayRenderer.vue", () => ({
  default: { name: "OverlayRenderer", template: "<div class='overlay-renderer' />" },
}));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, cb: (...args: unknown[]) => void) => {
    const set = h.listeners.get(type) ?? new Set();
    set.add(cb);
    h.listeners.set(type, set);
  },
}));
vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: h.send,
    listen: vi.fn(() => () => {}),
    isWindowOpen: vi.fn(() => false),
  },
}));
vi.mock("@/helpers/IndexedDB", () => ({
  default: { get: h.idb, getAll: vi.fn(async () => []) },
}));
vi.mock("@/helpers/LibraryFiles", () => ({
  openLibraryFileApi: h.api,
}));
vi.mock("@/helpers/Heic", () => ({
  heicBlobToJpeg: h.heicToJpeg,
}));

import BackgroundProjection from "@/views/BackgroundProjection.vue";
import BackgroundProjectionReturn from "@/views/BackgroundProjectionReturn.vue";

const i18n = createI18n({
  legacy: false,
  locale: "pt",
  messages: {
    pt: {
      projection: {
        video_unavailable: "Vídeo indisponível",
        video_unavailable_hint: "Tente novamente",
      },
    },
  },
});

function emit(type: string, payload: unknown): void {
  for (const cb of h.listeners.get(type) ?? []) cb(payload);
}

describe.each([
  ["BackgroundProjection", BackgroundProjection],
  ["BackgroundProjectionReturn", BackgroundProjectionReturn],
] as const)("%s local video synchronization (#73)", (_name, Component) => {
  let wrapper: VueWrapper;
  let pausedFlag = true;
  let currentTimeValue = 0;

  beforeEach(() => {
    setActivePinia(createPinia());
    h.listeners.clear();
    h.send.mockReset().mockReturnValue({ crossWindow: true });
    h.idb.mockReset();
    h.api.mockReset();
    pausedFlag = true;
    currentTimeValue = 0;

    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:resolved-local"),
        revokeObjectURL: vi.fn(),
      })
    );

    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {
      pausedFlag = false;
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
      pausedFlag = true;
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get: () => pausedFlag,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => currentTimeValue,
      set: (value: number) => {
        currentTimeValue = value;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => 4,
    });

    wrapper = mount(Component, {
      global: { plugins: [i18n] },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not autoplay or loop, waits for unpaused VIDEO_STATE, seeks, and pauses at end", async () => {
    emit(BROADCAST_TYPE.FILE_PROJECTION, {
      playback_id: "vid-1",
      stage_epoch: 1,
      type: "video",
      url: "https://example.test/culto.mp4",
      title: "Culto",
    });
    await flushPromises();

    const video = wrapper.find("video");
    expect(video.exists()).toBe(true);
    expect(video.attributes("autoplay")).toBeUndefined();
    expect(video.attributes("loop")).toBeUndefined();
    await video.trigger("loadedmetadata");
    expect(h.send).toHaveBeenCalledWith(
      BROADCAST_TYPE.REQUEST_VIDEO_STATE,
      expect.objectContaining({ playback_id: "vid-1" })
    );
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    // Audio still buffering: controller broadcasts isPaused: true at t=0
    emit(BROADCAST_TYPE.VIDEO_STATE, {
      playback_id: "vid-1",
      revision: 1,
      currentTime: 0,
      duration: 120,
      isPaused: true,
    });
    await flushPromises();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    // Audio is ready and actually started playing
    emit(BROADCAST_TYPE.VIDEO_STATE, {
      playback_id: "vid-1",
      revision: 2,
      currentTime: 0,
      duration: 120,
      isPaused: false,
    });
    await flushPromises();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    // Scenario 2: seek via player bar moves projected video to the target timestamp
    emit(BROADCAST_TYPE.VIDEO_STATE, {
      playback_id: "vid-1",
      revision: 3,
      currentTime: 42.5,
      duration: 120,
      isPaused: false,
    });
    await flushPromises();
    expect(currentTimeValue).toBeCloseTo(42.5, 1);

    // Stale revision or foreign playback_id must not regress currentTime
    emit(BROADCAST_TYPE.VIDEO_STATE, {
      playback_id: "vid-1",
      revision: 2,
      currentTime: 1,
      duration: 120,
      isPaused: false,
    });
    emit(BROADCAST_TYPE.VIDEO_STATE, {
      playback_id: "other-vid",
      revision: 99,
      currentTime: 3,
      duration: 120,
      isPaused: false,
    });
    expect(currentTimeValue).toBeCloseTo(42.5, 1);

    // Pause / end of audio pauses the projected video instead of looping
    emit(BROADCAST_TYPE.VIDEO_STATE, {
      playback_id: "vid-1",
      revision: 4,
      currentTime: 120,
      duration: 120,
      isPaused: true,
    });
    await flushPromises();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(pausedFlag).toBe(true);
  });

  it("resolves managed library reference blobs cleanly in background projection", async () => {
    h.idb.mockResolvedValue({
      data: new Uint8Array([0, 1, 2, 3]).buffer,
      mime: "video/mp4",
    });

    emit(BROADCAST_TYPE.FILE_PROJECTION, {
      playback_id: "lib-1",
      stage_epoch: 1,
      type: "video",
      url: "blob:origin-window",
      libRef: { id: "vid-123", table: "media_library" },
      title: "Local",
    });
    await flushPromises();

    const video = wrapper.find("video");
    expect(video.exists()).toBe(true);
    expect(video.attributes("src")).toBe("blob:resolved-local");
  });
});
