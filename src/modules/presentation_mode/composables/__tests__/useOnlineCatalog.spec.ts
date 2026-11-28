import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/helpers/Database", () => ({ default: { get } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { captureException: vi.fn() } }));

import { youtubeThumb } from "@/helpers/OnlineVideo";
import { useOnlineCatalog, type OnlineCatalogData } from "../useOnlineCatalog";

const data: OnlineCatalogData = {
  channels: [
    { channel_id: "c2", title: "Zeta" },
    { channel_id: "c1", title: "Alpha" },
  ],
  playlists: [
    { playlist_id: "p2", channel_id: "c1", title: "Alpha 2" },
    { playlist_id: "p1", channel_id: "c1", title: "Alpha 1" },
    { playlist_id: "p3", channel_id: "c2", title: "Zeta 1" },
  ],
  videos: [
    { video_id: "v1", playlist_id: "p1", title: "Um" },
    { video_id: "v2", playlist_id: "p2", title: "Dois" },
    { video_id: "v1", playlist_id: "p2", title: "Um repetido" },
    { video_id: "v3", playlist_id: "p3", title: "Três" },
  ],
};

describe("catálogo online da apresentação", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue(data);
  });

  it("ordena canais e playlists, deduplica vídeos e conta o canal", async () => {
    const catalog = useOnlineCatalog();
    await catalog.load("pt", true);

    expect(catalog.channels.value.map((channel) => channel.title)).toEqual(["Alpha", "Zeta"]);
    expect(catalog.playlistsOfChannel("c1").map((playlist) => playlist.title)).toEqual([
      "Alpha 1",
      "Alpha 2",
    ]);
    expect(catalog.allVideos.value.map((video) => video.video_id)).toEqual(["v2", "v3", "v1"]);
    expect(catalog.videosOfChannel("c1").map((video) => video.video_id)).toEqual(["v2", "v1"]);
    expect(catalog.videosOfPlaylist("p2").map((video) => video.video_id)).toEqual(["v2", "v1"]);
    expect(catalog.channelTitleOfVideo(data.videos[0])).toBe("Alpha");
    expect(catalog.firstVideoIdOfPlaylist("p1")).toBe("v1");
    expect(catalog.playlistThumb(data.playlists[0])).toBe(youtubeThumb("v2"));
  });

  it("mantém o erro quando o catálogo não está disponível", async () => {
    get.mockResolvedValue(null);
    const catalog = useOnlineCatalog();
    await catalog.load("es", true);

    expect(catalog.error.value).toBe(true);
    expect(catalog.channels.value).toEqual([]);
    expect(catalog.allVideos.value).toEqual([]);
  });
});
