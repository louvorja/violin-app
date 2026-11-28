import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  put: vi.fn(async () => {}),
  fetchTitle: vi.fn(async () => "Título do YouTube"),
  startForNewLink: vi.fn(async () => true),
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: { getAll: mocks.getAll, put: mocks.put },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: { captureException: vi.fn() } }));
vi.mock("@/helpers/OnlineVideo", () => ({
  fetchYoutubeTitle: mocks.fetchTitle,
  youtubeThumb: (id: string) => `https://thumb.test/${id}.jpg`,
}));
vi.mock("@/composables/useOnlineVideoDownloads", () => ({
  useOnlineVideoDownloads: () => ({ startForNewLink: mocks.startForNewLink }),
}));

import {
  useCustomOnlineVideos,
  type CustomOnlineCategory,
  type CustomOnlineVideo,
} from "../useCustomOnlineVideos";

const videos: CustomOnlineVideo[] = [
  {
    id: "v1",
    name: "Primeiro",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    createdAt: "2026-01-01T10:00:00.000Z",
    categoryId: "c1",
  },
  {
    id: "v2",
    name: "Segundo",
    url: "https://youtu.be/zyxwvutsrqp",
    createdAt: "2026-01-02T10:00:00.000Z",
  },
];
const categories: CustomOnlineCategory[] = [
  { id: "c1", name: "Natureza", color: "#3a7" },
  { id: "c2", name: "Culto" },
];

describe("meus vídeos online na apresentação", () => {
  beforeEach(() => {
    mocks.getAll.mockReset();
    mocks.put.mockReset();
    mocks.fetchTitle.mockReset();
    mocks.startForNewLink.mockReset();
    mocks.getAll.mockImplementation(async (table: string) => {
      if (table === DB_TABLE.CUSTOM_ONLINE_VIDEOS) return videos.map((video) => ({ ...video }));
      if (table === DB_TABLE.CUSTOM_ONLINE_VIDEOS_CATEGORIES) return categories;
      if (table === DB_TABLE.CUSTOM_ONLINE_VIDEOS_THUMBNAILS) {
        return [{ id: "v1", video_id: "v1", blob: new ArrayBuffer(4), mime: "image/jpeg" }];
      }
      return [];
    });
    mocks.fetchTitle.mockResolvedValue("Título do YouTube");
    mocks.startForNewLink.mockResolvedValue(true);
  });

  it("carrega, conta e resolve miniaturas em cache ou no YouTube", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:v1");
    const custom = useCustomOnlineVideos();
    await custom.load();

    expect(custom.videos.value.map((video) => video.id)).toEqual(["v2", "v1"]);
    expect(custom.countOf("c1")).toBe(1);
    expect(custom.countOf("")).toBe(1);
    expect(custom.hasUncategorized.value).toBe(true);
    expect(custom.thumbOf(videos[0])).toBe("blob:v1");
    expect(custom.thumbOf(videos[1])).toBe("https://thumb.test/zyxwvutsrqp.jpg");

    create.mockRestore();
  });

  it("aceita ícone de imagem da categoria a partir dos bytes", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cat");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const custom = useCustomOnlineVideos();
    const category: CustomOnlineCategory = {
      id: "c3",
      name: "Com imagem",
      iconType: "image",
      icon: "blob:antigo",
      iconData: new ArrayBuffer(3),
      iconMime: "image/png",
    };

    expect(custom.categoryImageOf(category)).toBe("blob:cat");
    expect(custom.categoryImageOf(category)).toBe("blob:cat");
    expect(create).toHaveBeenCalledTimes(1);
    custom.disposeThumbs();
    expect(revoke).toHaveBeenCalledWith("blob:cat");
    create.mockRestore();
    revoke.mockRestore();
  });

  it("recusa link inválido e duplicado", async () => {
    const custom = useCustomOnlineVideos();
    await custom.load();

    expect(await custom.addVideo({ url: "https://example.com/video" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(
      await custom.addVideo({ url: "https://youtu.be/abcdefghijk" })
    ).toEqual({ ok: false, error: "duplicate" });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("adiciona na biblioteca e inicia o download", async () => {
    const custom = useCustomOnlineVideos();
    await custom.load();

    const result = await custom.addVideo({
      url: "https://www.youtube.com/shorts/qqqqqqqqqqq",
      name: "Novo",
      categoryId: "c2",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.video).toMatchObject({ name: "Novo", categoryId: "c2" });
    expect(mocks.put).toHaveBeenCalledWith(
      DB_TABLE.CUSTOM_ONLINE_VIDEOS,
      expect.objectContaining({ name: "Novo", categoryId: "c2" })
    );
    expect(mocks.startForNewLink).toHaveBeenCalledWith("qqqqqqqqqqq", "Novo");
    expect(custom.countOf("c2")).toBe(1);
  });

  it("usa o ID como nome e enriquece o título quando o nome fica vazio", async () => {
    const custom = useCustomOnlineVideos();
    await custom.load();

    const result = await custom.addVideo({
      url: "https://youtu.be/mmmmmmmmmmm",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.video.name).toBe("mmmmmmmmmmm");
    await vi.waitFor(() => expect(mocks.fetchTitle).toHaveBeenCalledWith("mmmmmmmmmmm"));
    await vi.waitFor(() =>
      expect(custom.videos.value.find((video) => video.id === result.video.id)?.name).toBe(
        "Título do YouTube"
      )
    );
  });
});
