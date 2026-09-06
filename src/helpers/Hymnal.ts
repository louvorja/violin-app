/** @category helper-puro — Número do hino de uma música. Sem APIs Vue.
 *
 * O número não vive na música: vive no vínculo dela com o álbum, e só vale
 * quando esse álbum é um hinário — a mesma música pode ser a faixa 3 de uma
 * coletânea e o hino 428 do Hinário Adventista.
 */
import type { AlbumItem } from "@/types/Album";

interface MusicWithAlbums {
  albums?: AlbumItem[] | null;
}

/** Números de hino da música — vazio quando ela não está em nenhum hinário. */
export function hymnalTracks(music: MusicWithAlbums | null | undefined): number[] {
  if (!music || !Array.isArray(music.albums)) return [];
  return music.albums
    .filter((album) => album?.name && album.type === "hymnal" && album.pivot?.track != null)
    .map((album) => Number(album.pivot?.track))
    .filter((track) => Number.isFinite(track));
}

/** A música é o hino de número `value` em algum hinário? */
export function isHymnalTrack(
  music: MusicWithAlbums | null | undefined,
  value: number | string
): boolean {
  const num = Number(value);
  if (!Number.isFinite(num)) return false;
  return hymnalTracks(music).includes(num);
}

export default { hymnalTracks, isHymnalTrack };
