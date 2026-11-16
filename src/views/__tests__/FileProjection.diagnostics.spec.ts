import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia } from "pinia";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import FileProjection from "@/views/FileProjection.vue";
import FileProjectionReturn from "@/views/FileProjectionReturn.vue";

const h = vi.hoisted(() => ({
  listeners: new Map<string, ((_payload: unknown) => unknown)[]>(),
  log: vi.fn(),
  track: vi.fn(),
  exception: vi.fn(),
  send: vi.fn(),
  idb: vi.fn(),
  api: vi.fn(),
  heicToJpeg: vi.fn(),
}));
vi.mock("@/composables/useBroadcastListener", () => ({
  useBroadcastListener: (type: string, callback: (_payload: unknown) => unknown) => {
    h.listeners.set(type, [...(h.listeners.get(type) || []), callback]);
  },
}));
vi.mock("@/composables/useProjectionCloseNotice", () => ({ useProjectionCloseNotice: vi.fn() }));
vi.mock("@/components/OverlayRenderer.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/helpers/SettingsStorage", () => ({ getSetting: async () => null }));
vi.mock("@/helpers/IndexedDB", () => ({ default: { get: h.idb } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: {
    log: h.log,
    track: h.track,
    captureException: h.exception,
    setRuntimeContext: vi.fn(),
  },
}));
vi.mock("@/helpers/Broadcast", () => ({ default: { send: h.send } }));
vi.mock("@/composables/useYouTubeApi", () => ({ loadYtApi: h.api }));
vi.mock("@/helpers/ImageConvert", () => ({
  heicToJpeg: h.heicToJpeg,
  isHeic: (name?: string, mime?: string) =>
    /\.(heic|heif)$/i.test(name || "") || /^image\/hei[cf]$/i.test(mime || ""),
}));

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });
const ID = "T8YHfGrk3ok";
function emit(type: string, payload: unknown) {
  for (const listener of h.listeners.get(type) || []) listener(payload);
}
const projection = (playback_id: string, stage_epoch = 1, extra = {}) => ({
  playback_id,
  stage_epoch,
  type: "video",
  url: "https://private.example/original.mov?signature=secret",
  ...extra,
});

describe.each([
  ["projection", FileProjection, "auxiliary"],
  ["return", FileProjectionReturn, "auxiliary_return"],
] as const)("%s media failure diagnostics", (_surface, Component, role) => {
  let wrapper: VueWrapper;
  beforeEach(() => {
    vi.useFakeTimers();
    h.listeners.clear();
    h.log.mockReset();
    h.track.mockReset();
    h.exception.mockReset();
    h.idb.mockReset();
    h.api.mockReset();
    h.heicToJpeg.mockReset();
    h.send.mockReset().mockReturnValue({ crossWindow: true });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:local-object"),
        revokeObjectURL: vi.fn(),
      })
    );
    wrapper = mount(Component, { global: { plugins: [i18n, createPinia()] } });
  });
  afterEach(() => {
    wrapper?.unmount();
    Reflect.deleteProperty(window, "YT");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("preserves real library Blob MIME/bytes and reference when play rejects", async () => {
    h.idb.mockResolvedValue({
      data: new TextEncoder().encode("not a video").buffer,
      mime: "text/html",
    });
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException("unsupported blob:private", "NotSupportedError")
    );
    emit(
      BROADCAST_TYPE.FILE_PROJECTION,
      projection("attempt", 1, {
        url: "blob:foreign",
        libRef: { id: "file-123", table: "media_library" },
      })
    );
    await flushPromises();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    emit(BROADCAST_TYPE.VIDEO_STATE, {
      playback_id: "attempt",
      revision: 1,
      currentTime: 0,
      duration: 60,
      isPaused: false,
      sampledAt: Date.now(),
    });
    await flushPromises();
    expect(h.log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("video play rejected"),
      expect.objectContaining({
        playback_id: "attempt",
        window_role: role,
        phase: "sync_play",
        source_scheme: "blob",
        stale_context: false,
        blob_resolution: "resolved",
        requested_source: expect.objectContaining({
          blob_mime: "text/html",
          blob_bytes: 11,
          codec: "unknown",
          library_id: "file-123",
          library_table: "media_library",
        }),
      })
    );
    expect(JSON.stringify(h.log.mock.calls)).not.toMatch(/blob:foreign|blob:private|not a video/);
  });

  it("converts HEIC from the library inside the projection window", async () => {
    const jpeg = new Blob(["jpeg bytes"], { type: "image/jpeg" });
    h.heicToJpeg.mockResolvedValue(jpeg);
    h.idb.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]).buffer,
      mime: "image/heic",
      name: "foto.heic",
    });
    emit(BROADCAST_TYPE.FILE_PROJECTION, projection("photo", 1, {
      type: "image",
      url: "blob:created-in-main-window",
      libRef: { id: "heic-photo", table: "media_library" },
      heic: true,
    }));
    await flushPromises();
    expect(h.heicToJpeg).toHaveBeenCalledWith(expect.objectContaining({ type: "image/heic" }));
    expect(URL.createObjectURL).toHaveBeenCalledWith(jpeg);
    expect(wrapper.find("img").attributes("src")).toBe("blob:local-object");
  });

  it("attributes an old play rejection to its original identity after the same video node changes source", async () => {
    let reject!: (_error: Error) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      })
    );
    emit(BROADCAST_TYPE.FILE_PROJECTION, projection("first"));
    await flushPromises();
    emit(BROADCAST_TYPE.VIDEO_STATE, {
      playback_id: "first",
      revision: 1,
      currentTime: 0,
      duration: 60,
      isPaused: false,
      sampledAt: Date.now(),
    });
    await flushPromises();
    emit(
      BROADCAST_TYPE.FILE_PROJECTION,
      projection("second", 2, { url: "https://private.example/next.mp4?token=secret" })
    );
    await flushPromises();
    reject(new DOMException("No supported source", "NotSupportedError"));
    await flushPromises();
    const diagnostic = h.log.mock.calls.find(([, message]) =>
      String(message).includes("video play rejected")
    )?.[2];
    expect(diagnostic).toMatchObject({
      playback_id: "first",
      stale_context: true,
      snapshot_omitted: "source_replaced",
      requested_source: { file_ext: "mov", file_basename: "original.mov" },
    });
    expect(diagnostic).not.toHaveProperty("ready_state");
    expect(JSON.stringify(diagnostic)).not.toMatch(/second|next\.mp4|signature|token/);
  });

  it("records code 4, actual media states and missing library data once at the existing error boundary", async () => {
    h.idb.mockResolvedValue(null);
    emit(
      BROADCAST_TYPE.FILE_PROJECTION,
      projection("missing", 1, { url: "blob:foreign", libRef: { id: "file-123" } })
    );
    await flushPromises();
    const el = wrapper.find("video").element;
    Object.defineProperty(el, "error", { value: { code: 4, message: "unsupported blob:private" } });
    await wrapper.find("video").trigger("error");
    expect(h.log).toHaveBeenCalledWith(
      "error",
      "file projection video failed",
      expect.objectContaining({
        playback_id: "missing",
        window_role: role,
        reason: "source_not_supported",
        media_error_code: 4,
        blob_resolution: "library_record_missing",
        ready_state: 0,
        buffered_ranges: [],
      })
    );
    expect(h.exception).toHaveBeenCalledTimes(1);
  });

  it.each(["iframe_api", "player_construct"])(
    "distinguishes %s failures without claiming player state",
    async (phase) => {
      if (phase === "iframe_api")
        h.api.mockRejectedValue(new Error("timeout https://provider?token=secret"));
      else
        h.api.mockResolvedValue({
          Player: class {
            constructor() {
              throw new Error("construction failed");
            }
          },
        });
      emit(
        BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION,
        projection("youtube", 1, { type: "youtube", url: `https://www.youtube.com/embed/${ID}` })
      );
      await flushPromises();
      expect(h.log).toHaveBeenCalledWith(
        "warn",
        "youtube iframe API failed",
        expect.objectContaining({
          playback_id: "youtube",
          video_id: ID,
          window_role: role,
          phase,
          reason: phase === "iframe_api" ? "api_load_failed" : "player_constructor_failed",
        })
      );
      expect(JSON.stringify(h.log.mock.calls)).not.toMatch(/token|provider/);
    }
  );

  it("logs state delivery failure once across polls and then the first successful send", async () => {
    let events!: { onReady: () => void };
    const api = {
      PlayerState: { PLAYING: 1 },
      Player: class {
        constructor(_element: unknown, options: { events: typeof events }) {
          events = options.events;
        }
        playVideo() {}
        unMute() {}
        destroy() {}
        getCurrentTime() {
          return 1;
        }
        getDuration() {
          return 100;
        }
        getPlayerState() {
          return 1;
        }
      },
    };
    Object.assign(window, { YT: api });
    h.api.mockResolvedValue(api);
    h.send.mockReturnValue({ crossWindow: false });
    emit(
      BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION,
      projection("youtube", 1, { type: "youtube", url: `https://www.youtube.com/embed/${ID}` })
    );
    await flushPromises();
    events.onReady();
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      h.log.mock.calls.filter(([, message]) => message === "youtube state publication failed")
    ).toHaveLength(1);
    expect(h.log).toHaveBeenCalledWith(
      "warn",
      "youtube state publication failed",
      expect.objectContaining({ reason: "state_delivery_failed", playback_id: "youtube" })
    );
    h.send.mockReturnValue({ crossWindow: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      h.log.mock.calls.filter(([, message]) => message === "youtube first state published")
    ).toHaveLength(1);
  });
});
