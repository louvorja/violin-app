import type { Playable } from "./playable";

/** Uma música do acervo como a biblioteca a entrega ao palco e ao programa. */
export interface LibrarySong {
  id_music: number;
  name: string;
  /** "00:03:39" do catálogo. */
  duration?: string;
  album: string;
  track?: number;
  has_instrumental_music: boolean;
  /** Música personalizada (acervo do operador): o UUID que a executa. */
  customId?: string;
}

export function songPlayable(song: LibrarySong): Playable {
  return {
    type: "song",
    id_music: song.id_music,
    title: song.name,
    subtitle: song.album,
    ...(song.customId ? { customId: song.customId } : {}),
  };
}
