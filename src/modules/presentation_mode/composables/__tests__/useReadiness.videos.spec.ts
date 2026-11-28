import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Program, ProgramItem } from "@/types/Presentation";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";

const stateOf = vi.fn();
const refresh = vi.fn(async () => {});

vi.mock("@/helpers/OnlineVideo", () => ({
  downloadAvailable: () => true,
  videoIdFromUrl: (url: string) => {
    const direct = url.match(/[?&]v=([\w-]{11})/)?.[1];
    if (direct) return direct;
    return url.match(/youtu\.be\/([\w-]{11})/)?.[1] ?? null;
  },
}));
vi.mock("@/composables/useOnlineVideoDownloads", () => ({
  useOnlineVideoDownloads: () => ({
    refresh,
    stateOf,
    download: vi.fn(async () => true),
  }),
}));
vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: false,
    listDir: vi.fn(async () => ({ ok: true, entries: [] })),
  },
}));
vi.mock("@/helpers/Database", () => ({ default: { get: vi.fn(async () => null) } }));
vi.mock("@/helpers/MediaUrl", () => ({ resolveMediaReference: () => null }));
vi.mock("@/helpers/Http", () => ({
  fetchWithTimeout: vi.fn(),
  NET_TIMEOUT: { MEDIA: 1 },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { captureException: vi.fn(), track: vi.fn() },
}));
vi.mock("@/i18n", () => ({
  i18nAtual: () => ({ global: { t: (key: string) => key } }),
}));
vi.mock("@/composables/useBackgroundTasks", () => ({
  useBackgroundTasks: () => ({
    registerTask: vi.fn(),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    cancelTask: vi.fn(),
  }),
}));
vi.mock("../useCloudFiles", () => ({
  useCloudFiles: () => ({
    refresh: vi.fn(async () => {}),
    stateOf: () => "local",
  }),
}));
vi.mock("../useChurchFolder", () => ({ useChurchFolder: () => ({ root: { value: null } }) }));
vi.mock("../useFileLibrary", () => ({ readFolder: vi.fn(async () => []) }));

const { useReadiness } = await import("../useReadiness");

const videoItem = (id: string, url: string, item = "Vídeo do culto"): ProgramItem =>
  ({
    id,
    title: "Momento",
    source: {
      tipo: LiturgyItemTypeEnum.VIDEO_ONLINE,
      url,
      item,
    },
  }) as unknown as ProgramItem;

function programWith(...items: ProgramItem[]): Program {
  return { sessions: [{ id: "s1", items }] } as unknown as Program;
}

describe("useReadiness — vídeos online", () => {
  beforeEach(() => {
    refresh.mockClear();
    stateOf.mockReset();
    stateOf.mockReturnValue("none");
    const readiness = useReadiness();
    readiness.state.videos = [];
    readiness.state.pending = [];
    readiness.state.songs = [];
    readiness.state.cloud = [];
    readiness.state.missing = [];
    readiness.state.empty = [];
    readiness.state.outside = [];
  });

  it("inclui o vídeo online que ainda não está no disco", async () => {
    const readiness = useReadiness();
    await readiness.check(
      programWith(videoItem("i1", "https://www.youtube.com/watch?v=abc12345678"))
    );

    expect(refresh).toHaveBeenCalled();
    expect(readiness.state.videos).toEqual([
      expect.objectContaining({
        videoId: "abc12345678",
        title: "Vídeo do culto",
      }),
    ]);
    expect(readiness.problems.value).toBe(1);
  });

  it("ignora vídeo já baixado e deduplica o mesmo link", async () => {
    stateOf.mockImplementation((id: string) => (id === "abc12345678" ? "downloaded" : "none"));

    const readiness = useReadiness();
    await readiness.check(
      programWith(
        videoItem("i1", "https://youtu.be/abc12345678"),
        videoItem("i2", "https://www.youtube.com/watch?v=abc12345678")
      )
    );

    expect(readiness.state.videos).toEqual([]);
    expect(readiness.problems.value).toBe(0);
  });

  it("não inclui link de vídeo que não é do YouTube", async () => {
    const readiness = useReadiness();
    await readiness.check(programWith(videoItem("i1", "https://example.com/video.mp4")));

    expect(readiness.state.videos).toEqual([]);
  });
});
