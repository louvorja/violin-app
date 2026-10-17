import { Lyric } from "@/types/Lyric";
import { Album, AlbumItem } from "@/types/Album";

export interface Music {
  id_music: number;
  name: string;
  duration: string;
  instrumental_duration?: string;
  image_position?: string | number;
  url_image?: string;
  url_music?: string;
  url_instrumental_music?: string;
  /** O acervo antigo entrega as letras como objeto indexado; o novo, como lista. */
  lyric?: Lyric[] | Record<string, Lyric>;
  albums?: Album[];
}

export interface MusicAlbum {
  id_music: number;
  name: string;
  has_instrumental_music?: boolean;
  duration?: string;
  track?: number;
}

export interface MusicItem {
  id_music: number;
  name: string;
  has_instrumental_music?: boolean;
  duration?: string;
  lyric?: string;
  albums_names?: string;
  albums: AlbumItem[];
}

/** Álbum de música do controle remoto (oficial ou coletânea personalizada). */
export interface MusicLibraryAlbum {
  id: string;
  title: string | null;
  subtitle: string | null;
  /** 0 = contagem desconhecida (álbuns oficiais) — o card não mostra badge. */
  count: number;
  source: "official" | "custom";
  /** Módulo dono do álbum (pins do hinário) — o card usa o ícone do módulo. */
  module_id?: string | null;
  color: string | null;
  image: string | null;
}

export interface SearchMusicItem extends MusicItem {
  track?: string | number;
  album?: string;
  custom_song_id?: string;
  custom_collection_names?: string[];
  /** Música personalizada: tem faixa cantada. No acervo oficial toda música tem. */
  has_audio?: boolean;
}

export interface PlaylistSong {
  id_music: number;
  name: string;
  duration: number;
  has_instrumental_music: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  songs: PlaylistSong[];
  createdAt: string;
  updatedAt: string;
}
