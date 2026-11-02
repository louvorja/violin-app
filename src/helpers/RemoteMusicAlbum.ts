import Database from "@/helpers/Database";

export interface RemoteMusicAlbumResponse {
  album: {
    id_album: number;
    name: string;
    musics: Array<{
      id_music: number;
      name: string;
      duration: string | number;
      has_instrumental_music: number;
    }>;
  } | null;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** O bundle instala álbuns no IndexedDB, sem criar album_<id>.json no main. */
export async function readRemoteMusicAlbum(request: unknown): Promise<RemoteMusicAlbumResponse> {
  if (!record(request) || !Number.isSafeInteger(request.albumId) || Number(request.albumId) <= 0) {
    return { album: null };
  }
  const albumId = Number(request.albumId);
  const album = await Database.getLocal(`album_${albumId}`);
  if (!record(album) || !Array.isArray(album.musics) || album.musics.length > 5_000) {
    return { album: null };
  }
  return {
    album: {
      id_album: albumId,
      name: typeof album.name === "string" ? album.name.slice(0, 1_000) : "",
      musics: album.musics
        .filter(
          (music) =>
            record(music) &&
            Number.isSafeInteger(Number(music.id_music)) &&
            Number(music.id_music) > 0
        )
        .map((music) => ({
          id_music: Number(music.id_music),
          name: typeof music.name === "string" ? music.name.slice(0, 500) : "",
          duration:
            typeof music.duration === "string"
              ? music.duration.slice(0, 16)
              : typeof music.duration === "number" &&
                  Number.isFinite(music.duration) &&
                  music.duration >= 0
                ? music.duration
                : "",
          has_instrumental_music: music.has_instrumental_music ? 1 : 0,
        })),
    },
  };
}
