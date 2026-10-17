import { computed, effectScope, shallowRef, watch, type ComputedRef } from "vue";
import Platform from "@/helpers/Platform";
import Database from "@/helpers/Database";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";
import { resolveMediaReference } from "@/helpers/MediaUrl";

/**
 * O que dá para tocar sem internet: músicas cujo áudio cantado está no
 * aparelho, e os álbuns que têm ao menos uma delas. Só existe enquanto o app
 * está offline — online, as listas mostram tudo.
 */
interface OfflineLibrary {
  musics: Set<number>;
  albums: Set<number>;
}

interface MusicRow {
  id_music: number | string;
  albums?: Array<{ id_album: number | string }>;
}

const READ_BATCH = 40;
const CHECK_BATCH = 500;

const _libraries = shallowRef(new Map<string, OfflineLibrary>());
const _pending = new Map<string, Promise<void>>();
const _isOnline = computed(() => $appdata.get<boolean>(KEYS.SHELL.IS_ONLINE, true) !== false);

function addAlbum(map: Map<number, number[]>, musicId: number, albumId: number): void {
  const list = map.get(musicId);
  if (list) list.push(albumId);
  else map.set(musicId, [albumId]);
}

async function albumsOfMusics(lang: string): Promise<Map<number, number[]> | null> {
  const rows = await Database.getLocal<MusicRow[]>(`${lang}_musics`);
  if (!Array.isArray(rows)) return null;
  const albumsOf = new Map<number, number[]>();
  for (const row of rows) {
    const id = Number(row.id_music);
    if (!Number.isFinite(id)) continue;
    albumsOf.set(id, []);
    row.albums?.forEach((a) => addAlbum(albumsOf, id, Number(a.id_album)));
  }
  // Doxologia e Infantil não aparecem no catálogo geral: as músicas vêm do álbum.
  for (const key of [`${lang}_doxology_albums`, `${lang}_children_albums`]) {
    const albums = await Database.getLocal<Array<{ id_album: number | string }>>(key);
    for (const album of Array.isArray(albums) ? albums : []) {
      const albumId = Number(album.id_album);
      const detail = await Database.getLocal<{ musics?: Array<{ id_music: number | string }> }>(
        `album_${albumId}`,
        { remember: false }
      );
      detail?.musics?.forEach((m) => addAlbum(albumsOf, Number(m.id_music), albumId));
    }
  }
  return albumsOf;
}

async function scan(lang: string): Promise<OfflineLibrary | null> {
  const checkLocal = Platform.storage?.checkLocal;
  if (!checkLocal) return null;
  const albumsOf = await albumsOfMusics(lang);
  if (!albumsOf) return null;

  const musicsOf = new Map<string, number[]>();
  const ids = [...albumsOf.keys()];
  for (let i = 0; i < ids.length; i += READ_BATCH) {
    await Promise.all(
      ids.slice(i, i + READ_BATCH).map(async (id) => {
        const detail = await Database.getLocal<{ url_music?: string | null }>(`music_${id}`, {
          remember: false,
        });
        const remote = resolveMediaReference(detail?.url_music)?.relativePath;
        if (!remote) return;
        const list = musicsOf.get(remote);
        if (list) list.push(id);
        else musicsOf.set(remote, [id]);
      })
    );
  }

  const musics = new Set<number>();
  const remotes = [...musicsOf.keys()];
  for (let i = 0; i < remotes.length; i += CHECK_BATCH) {
    const slice = remotes.slice(i, i + CHECK_BATCH);
    const local = (await checkLocal(slice)) as Record<string, unknown>;
    slice.forEach((remote) => {
      if (local[remote]) musicsOf.get(remote)?.forEach((id) => musics.add(id));
    });
  }

  const albums = new Set<number>();
  musics.forEach((id) => albumsOf.get(id)?.forEach((albumId) => albums.add(albumId)));
  return { musics, albums };
}

function ensure(lang: string): void {
  if (_libraries.value.has(lang) || _pending.has(lang)) return;
  const run = scan(lang)
    .then((library) => {
      if (!library || _isOnline.value) return;
      const next = new Map(_libraries.value);
      next.set(lang, library);
      _libraries.value = next;
    })
    .catch((e) => console.warn("[useOfflineLibrary] varredura falhou:", e))
    .finally(() => _pending.delete(lang));
  _pending.set(lang, run);
}

let _installed = false;

// Uma varredura vale até a internet voltar: o que se baixar depois disso só
// aparece na próxima queda, quando ela é refeita.
function install(): void {
  if (_installed) return;
  _installed = true;
  // Escopo próprio: o primeiro componente a usar isto pode desmontar.
  effectScope(true).run(() =>
    watch(_isOnline, (online) => {
      if (online && _libraries.value.size) _libraries.value = new Map();
    })
  );
}

export interface OfflineLibraryView {
  /** O filtro está valendo: offline e com a varredura concluída. */
  active: ComputedRef<boolean>;
  /** Offline, mas sem catálogo neste aparelho para mostrar. */
  offline: ComputedRef<boolean>;
  hasMusic: (id: unknown) => boolean;
  hasAlbum: (id: unknown) => boolean;
}

export function useOfflineLibrary(lang: () => string): OfflineLibraryView {
  install();
  watch(
    [_isOnline, lang],
    ([online, current]) => {
      if (!online && current) ensure(current);
    },
    { immediate: true }
  );
  const library = computed(() => (_isOnline.value ? null : (_libraries.value.get(lang()) ?? null)));
  return {
    active: computed(() => library.value !== null),
    offline: computed(() => !_isOnline.value),
    hasMusic: (id) => library.value?.musics.has(Number(id)) ?? true,
    hasAlbum: (id) => library.value?.albums.has(Number(id)) ?? true,
  };
}

/** Só para os testes. */
export function _resetOfflineLibrary(): void {
  _libraries.value = new Map();
  _pending.clear();
}
