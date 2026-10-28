/** Regras do catálogo compartilhadas pelo renderer e pela busca remota. */
export const HYMNAL_ALBUM_IDS = { current: 712, legacy: 629 };
const musicNames = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** @typedef {{ id_album: number|string, name?: string, year?: number|string, subtitle?: string, order?: number, type?: string, pivot?: { track?: number|string } }} CatalogAlbum */
/** @typedef {{ name?: string, albums?: CatalogAlbum[]|null, albums_names?: string, album?: string, custom_song_id?: string, custom_collection_names?: string[] }} CatalogMusic */

/** @param {unknown} value */
function yearIn(value) {
  const years = String(value ?? "").match(/\b(?:19|20)\d{2}\b/g) || [];
  return Math.max(0, ...years.map(Number));
}

/** @param {CatalogAlbum} album */
export function albumYear(album) {
  if (!album || typeof album !== "object") return 0;
  return (
    yearIn(album.year) ||
    yearIn(album.subtitle) ||
    yearIn(album.name) ||
    (Number(album.id_album) === HYMNAL_ALBUM_IDS.current
      ? 2022
      : Number(album.id_album) === HYMNAL_ALBUM_IDS.legacy
        ? 1996
        : 0)
  );
}

/** @param {unknown} categories */
export function albumYears(categories) {
  const years = new Map();
  if (!Array.isArray(categories)) return years;
  for (const category of categories) {
    if (!Array.isArray(category?.albums)) continue;
    for (const album of category.albums) {
      if (!album || album.id_album == null) continue;
      const id = String(album.id_album);
      years.set(id, Math.max(years.get(id) || 0, albumYear(album)));
    }
  }
  return years;
}

/** @param {number|string} id @param {(number|string)[]} disabled */
export function isAlbumEnabled(id, disabled = []) {
  return !disabled.some((value) => String(value) === String(id));
}

/**
 * Remove os vínculos desativados também dos nomes/números pesquisáveis.
 * Uma música compartilhada continua acessível pelos álbuns ativos.
 * @template {CatalogMusic} T
 * @param {T} music
 * @param {(number|string)[]} disabled
 * @param {Map<string, number>} years
 * @returns {T|null}
 */
export function visibleMusic(music, disabled = [], years = new Map()) {
  if (!Array.isArray(music.albums) || !music.albums.length) return music;
  const albums = music.albums
    .filter(
      (album) =>
        album &&
        typeof album === "object" &&
        album.id_album != null &&
        isAlbumEnabled(album.id_album, disabled)
    )
    .map((album) => ({
      ...album,
      year: yearIn(album.year) || years.get(String(album.id_album)) || albumYear(album),
    }))
    .sort((a, b) => albumYear(b) - albumYear(a) || (a.order || 0) - (b.order || 0));
  if (!albums.length) return null;
  return {
    ...music,
    albums,
    albums_names: albums
      .map((album) => album.name)
      .filter(Boolean)
      .join(", "),
  };
}

/** @param {CatalogMusic|null|undefined} music */
export function musicYear(music) {
  return Math.max(0, ...(Array.isArray(music?.albums) ? music.albums : []).map(albumYear));
}

/** Álbuns mais recentes primeiro; títulos em ordem alfabética dentro do ano. */
export function compareMusics(a, b) {
  return (
    musicYear(b) - musicYear(a) || musicNames.compare(String(a?.name ?? ""), String(b?.name ?? ""))
  );
}

/** @template {CatalogMusic} T @param {T[]} musics @param {(number|string)[]} disabled @param {Map<string, number>} years @returns {T[]} */
export function prepareMusicCatalog(musics, disabled = [], years = new Map()) {
  // Mesma ordem de `compareMusics`, mas o ano de cada música é calculado uma vez:
  // na comparação ele era refeito para as duas músicas em cada uma das ~20 mil
  // comparações do catálogo.
  return musics
    .filter((music) => music && typeof music === "object" && typeof music.name === "string")
    .map((music) => visibleMusic(music, disabled, years))
    .filter((music) => music !== null)
    .map((music) => ({ music, year: musicYear(music), name: String(music.name ?? "") }))
    .sort((a, b) => b.year - a.year || musicNames.compare(a.name, b.name))
    .map(({ music }) => music);
}

/** @param {CatalogMusic|null|undefined} music @returns {number[]} */
export function hymnalTracks(music) {
  return (Array.isArray(music?.albums) ? music.albums : [])
    .filter((album) => album?.type === "hymnal" && album.pivot?.track != null)
    .map((album) => Number(album.pivot?.track))
    .filter((track) => Number.isInteger(track) && track > 0);
}

/** @param {CatalogMusic|null|undefined} music @param {number|string} value */
export function isHymnalTrack(music, value) {
  return /^\d+$/.test(String(value).trim()) && hymnalTracks(music).includes(Number(value));
}

/** @param {CatalogAlbum} album */
export function albumLabel(album) {
  const track = Number(album.pivot?.track);
  return album.type === "hymnal" && Number.isInteger(track) && track > 0
    ? `Hino nº ${track} - ${album.name || ""}`
    : album.name || "";
}

/** @param {CatalogMusic} music @param {string} customLabel */
export function musicAlbumLabel(music, customLabel = "") {
  if (music.custom_song_id)
    return [customLabel, ...(music.custom_collection_names || [])].filter(Boolean).join(" · ");
  if (Array.isArray(music.albums) && music.albums.length)
    return music.albums.map(albumLabel).filter(Boolean).join(", ");
  return music.albums_names || music.album || "";
}

/** Nome da música com os números dos hinários ativos, sem confundir faixa com hino.
 * @param {CatalogMusic} music
 * @param {string} musicPrefix Prefixo opcional para músicas que não são hinos.
 */
export function musicTitle(music, musicPrefix = "") {
  const tracks = [...new Set(hymnalTracks(music))];
  return tracks.length
    ? `Hino nº ${tracks.join(" / ")} - ${music.name}`
    : `${musicPrefix ? musicPrefix + " " : ""}${music.name || ""}`;
}
