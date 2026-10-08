import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { KEYS } from "@/constants/UserDataKeys";
import type { Music } from "@/types/Music";

const h = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  fetch: vi.fn(),
  track: vi.fn(),
  exception: vi.fn(),
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    get: vi.fn(async (table: string, id: string) => h.rows.get(`${table}/${id}`)),
    getAll: vi.fn(async () => []),
    getAllByPrefix: vi.fn(async () => []),
    put: vi.fn(async (table: string, row: { id: string }) => {
      h.rows.set(`${table}/${row.id}`, row);
    }),
    putMany: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  },
}));
vi.mock("@/helpers/Path", () => ({
  default: { db: (path: string) => `https://api.test/json_db${path}` },
}));
vi.mock("@/config/Api", () => ({
  API_URL: "https://api.test",
  API_TOKEN: "",
  API_URL_FALLBACK: "https://fallback.test",
  API_URL_DB_FALLBACK: "https://fallback.test/json_db",
  API_URL_FALLBACK_TOKEN: "",
  apiOrigin: () => "https://api.test",
  API_URL_DB: "https://api.test/json_db",
  API_URL_FILES: "https://api.test/file",
  getTokenForUrl: () => "",
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: {
    track: h.track,
    captureException: h.exception,
    setRuntimeContext: vi.fn(),
    log: vi.fn(),
  },
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  openProjectionWindows: vi.fn(async () => {}),
  openVideoProjectionWindows: vi.fn(async () => {}),
  isVideoProjectionOpen: vi.fn(async () => false),
  openFileProjectionWindows: vi.fn(async () => {}),
  closeProjectionWindows: vi.fn(async () => {}),
  closeFileProjectionWindows: vi.fn(async () => {}),
  closeMusicProjectionWindows: vi.fn(async () => {}),
}));

type Media = typeof import("@/composables/useMedia").default;
let media: Media;
let launch: ReturnType<typeof vi.spyOn>;

const song: Music = { id_music: 123, name: "Música de teste", duration: "00:03:00", lyric: [] };

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, headers: new Headers(), json: async () => data } as Response;
}

function waitForAbort(signal: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

beforeEach(async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  h.rows.clear();
  h.fetch.mockReset();
  h.track.mockClear();
  h.exception.mockClear();
  vi.stubGlobal("fetch", h.fetch);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  media = (await import("@/composables/useMedia")).default;
  launch = vi.spyOn(media, "_launchProjection").mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(() => {
  media.clearVariables();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("music metadata deadline", () => {
  it("opens when primary times out at 10s and the fallback returns healthy metadata 6s later", async () => {
    h.fetch.mockImplementation((input: string, options: RequestInit) => {
      if (input.startsWith("https://api.test")) return waitForAbort(options.signal!);
      return new Promise<Response>((resolve) =>
        setTimeout(() => resolve(jsonResponse(song)), 6000)
      );
    });

    const opened = media.open(123);
    await vi.advanceTimersByTimeAsync(16_000);

    expect(await opened).toBe(true);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenCalledOnce();
    expect(h.exception).not.toHaveBeenCalled();
    const { default: appdata } = await import("@/helpers/AppData");
    expect(appdata.get(KEYS.MODULES.MEDIA.ID_MUSIC)).toBe(123);
  });

  it("still bounds a response whose headers arrive but whose JSON body never finishes", async () => {
    h.fetch.mockResolvedValue({
      ...jsonResponse(song),
      json: () => new Promise(() => {}),
    });
    let settled = false;
    const opened = media.open(123).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(24_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await opened).toBe(false);
    expect(launch).not.toHaveBeenCalled();
    expect(h.exception).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: "music_metadata_load", reason: "metadata_timeout" })
    );
    expect(media.getActivePlaybackId()).toBeNull();
  });

  it("settles immediately on close while a shared Database reader keeps its request and cache", async () => {
    let complete!: (_response: Response) => void;
    let requestSignal!: AbortSignal;
    h.fetch.mockImplementation((_input: string, options: RequestInit) => {
      requestSignal = options.signal!;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    });
    const opened = media.open(123);
    await vi.advanceTimersByTimeAsync(0);
    const { default: database } = await import("@/helpers/Database");
    const sharedReader = database.get<Music>("music_123");
    await vi.advanceTimersByTimeAsync(0);

    media.close(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(await opened).toBe(false);
    expect(requestSignal.aborted).toBe(false);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.exception).not.toHaveBeenCalled();
    complete(jsonResponse(song));
    expect(await sharedReader).toEqual(song);
    expect(await database.get<Music>("music_123")).toEqual(song);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(launch).not.toHaveBeenCalled();
    expect(h.exception).not.toHaveBeenCalled();
    expect(h.track).toHaveBeenCalledWith(
      "music_open_failed",
      expect.objectContaining({ id_music: 123, reason: "superseded" })
    );
  });

  it("reopening the same song cancels only the previous playback wait and reuses metadata", async () => {
    let complete!: (_response: Response) => void;
    h.fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    const previous = media.open(123);
    await vi.advanceTimersByTimeAsync(0);
    const previousPlayback = media.getActivePlaybackId();
    const current = media.open(123);
    await vi.advanceTimersByTimeAsync(0);

    expect(await previous).toBe(false);
    expect(media.getActivePlaybackId()).not.toBe(previousPlayback);
    expect(h.fetch).toHaveBeenCalledOnce();
    complete(jsonResponse(song));
    await vi.advanceTimersByTimeAsync(0);

    expect(await current).toBe(true);
    expect(launch).toHaveBeenCalledOnce();
    expect(h.exception).not.toHaveBeenCalled();
  });
});
