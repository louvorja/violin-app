/** @category deve-virar-composable — Usa UserData (Pinia); requer renderer. */
import $database from "@/helpers/Database";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

/** Registro da música no catálogo já baixado; `undefined` quando ele não está disponível. */
export async function findCatalogMusic(
  id_music: number | string
): Promise<Record<string, unknown> | undefined> {
  const lang = $userdata.get<string>(KEYS.OPTIONS.LANGUAGE, "pt") || "pt";
  const catalog = await $database
    .getLocal<Record<string, unknown>[]>(`${lang}_musics`)
    .catch(() => null);
  return Array.isArray(catalog)
    ? catalog.find((music) => Number(music.id_music) === Number(id_music))
    : undefined;
}
