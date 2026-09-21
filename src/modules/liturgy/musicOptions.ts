import { hymnalTracks } from "@/helpers/Hymnal";
import Strings from "@/helpers/Strings";
import type { AlbumItem } from "@/types/Album";
import type { LiturgyMusicItem } from "@/types/Liturgy";

// `type`, não `interface`: só o alias tem a assinatura de índice implícita que o
// LjCombobox exige dos itens.
export type MusicOption = {
  value: number;
  label: string;
  /** Nome do CD: títulos iguais existem em mais de um. */
  detail: string;
  /** Chaves de busca, normalizadas uma vez por lista e não a cada tecla. */
  nameKey: string;
  albumKey: string;
  tracks: number[];
};

export function buildMusicOptions(musics: LiturgyMusicItem[]): MusicOption[] {
  return musics
    .map((m) => {
      const detail = String(m.albums_names ?? "");
      return {
        value: Number(m.id_music),
        label: m.custom_song_id ? `♪ ${m.name}` : m.name,
        detail,
        nameKey: Strings.clean(m.name),
        albumKey: Strings.clean(detail),
        tracks: hymnalTracks(m as unknown as { albums?: AlbumItem[] }),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/** Mesma regra da busca de músicas: trecho do nome ou do CD, ou o número do hino. */
export function musicMatches(option: MusicOption, term: string): boolean {
  return (
    option.nameKey.includes(term) ||
    option.albumKey.includes(term) ||
    option.tracks.includes(Number(term))
  );
}
