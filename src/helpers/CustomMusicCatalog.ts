/** Índice leve do acervo pessoal para as buscas; slides e áudio são lidos só ao executar. */
import DocStore from "@/helpers/DocStore";
import { getSong, hasPlayback, hasSung, type CustomSong } from "@/helpers/CustomSongs";
import Media from "@/composables/useMedia";
import { DB_TABLE } from "@/constants/DbTables";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import type { SearchMusicItem } from "@/types/Music";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const filled = (value: unknown): boolean => typeof value === "string" && !!value;

export async function loadCustomMusicCatalog(): Promise<SearchMusicItem[]> {
  // Uma coletânea ilegível não deve esconder músicas que continuam disponíveis.
  const [songs, collections] = await Promise.all([
    DocStore.getAll<unknown>(DB_TABLE.CUSTOM_SONGS).catch(() => []),
    DocStore.getAll<unknown>(DB_TABLE.CUSTOM_COLLECTIONS).catch(() => []),
  ]);
  const namesBySong = new Map<string, Set<string>>();
  for (const collection of Array.isArray(collections) ? collections : []) {
    if (
      !record(collection) ||
      typeof collection.nome !== "string" ||
      !collection.nome.trim() ||
      !Array.isArray(collection.song_ids)
    )
      continue;
    for (const id of collection.song_ids) {
      if (typeof id !== "string" || !id.trim()) continue;
      const names = namesBySong.get(id) || new Set<string>();
      names.add(collection.nome.trim());
      namesBySong.set(id, names);
    }
  }

  const items = new Map<string, SearchMusicItem>();
  for (const song of Array.isArray(songs) ? songs : []) {
    if (
      !record(song) ||
      typeof song.id !== "string" ||
      !song.id.trim() ||
      typeof song.nome !== "string" ||
      !song.nome.trim() ||
      items.has(song.id)
    )
      continue;
    items.set(song.id, {
      // Compatibilidade com seletores existentes; execução usa sempre o UUID.
      id_music: -(items.size + 2),
      name: song.nome,
      custom_song_id: song.id,
      custom_collection_names: [...(namesBySong.get(song.id) || [])],
      has_audio: filled(song.audio_token),
      has_instrumental_music: filled(song.playback_token),
      albums: [],
    });
  }
  return [...items.values()];
}

/**
 * Único caminho de execução da música personalizada — listas, busca rápida,
 * paleta de comandos, liturgia e controle remoto passam por aqui.
 *
 * Sem ação pedida vale o cantado; o playback assume quando só ele existe.
 *
 * @returns `true` quando os slides foram projetados (tocar só o áudio não projeta).
 */
export async function playCustomSong(
  song: CustomSong,
  action?: MusicActionEnum | string,
  options?: { minimized?: boolean }
): Promise<boolean> {
  // Sem opções, a chamada fica como sempre foi: só quem tem o próprio palco as passa.
  const openSong = (mode: MusicActionEnum | string) =>
    options ? Media.openCustomSong(song, mode, options) : Media.openCustomSong(song, mode);
  switch (action) {
    case MusicActionEnum.AUDIO_ONLY:
      await Media.openCustomAudio(song, MusicActionEnum.AUDIO);
      return false;
    case MusicActionEnum.PLAYBACK_ONLY:
      await Media.openCustomAudio(song, MusicActionEnum.INSTRUMENTAL);
      return false;
    case undefined:
      return openSong(
        hasSung(song) || !hasPlayback(song) ? MusicActionEnum.AUDIO : MusicActionEnum.INSTRUMENTAL
      );
    default:
      return openSong(action);
  }
}

/** Executa pelo UUID, relendo o documento: a lista em tela pode estar desatualizada. */
export async function openCustomMusic(
  customSongId: string,
  action?: MusicActionEnum | string,
  options?: { minimized?: boolean }
): Promise<boolean> {
  const song = await getSong(customSongId);
  return song ? playCustomSong(song, action, options) : false;
}
