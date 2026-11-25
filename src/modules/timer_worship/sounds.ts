/**
 * Áudio de cada aviso do Temporizador de Culto (abertura, 5 min, 1 min).
 *
 * Cada aviso toca o som que vem com o programa, a não ser que o operador tenha
 * escolhido outro na Biblioteca de Mídia. A escolha guarda só o id do registro
 * e o nome (para a tela): o arquivo é relido da biblioteca na hora de tocar,
 * porque um `blob:` salvo não sobrevive a fechar o programa.
 */
import $userdata from "@/helpers/UserData";
import $idb from "@/helpers/IndexedDB";
import $path from "@/helpers/Path";
import { KEYS } from "@/constants/UserDataKeys";
import { DB_TABLE } from "@/constants/DbTables";
import { SABBATH_SCHOOL_SOUNDS } from "@/config/SabbathSchool";

export type WorshipCue = "start" | "five" | "one";

export const WORSHIP_CUES: WorshipCue[] = ["start", "five", "one"];

export interface WorshipSoundChoice {
  libraryId: string;
  name: string;
}

const CHOICE_KEYS: Record<WorshipCue, string> = {
  start: KEYS.MODULES.TIMER_WORSHIP.SOUND_START_FILE,
  five: KEYS.MODULES.TIMER_WORSHIP.SOUND_FIVE_MIN_FILE,
  one: KEYS.MODULES.TIMER_WORSHIP.SOUND_ONE_MIN_FILE,
};

/** Liga/desliga de cada aviso (as caixinhas da faixa). */
export const ENABLED_KEYS: Record<WorshipCue, string> = {
  start: KEYS.MODULES.TIMER_WORSHIP.SOUND_START,
  five: KEYS.MODULES.TIMER_WORSHIP.SOUND_FIVE_MIN,
  one: KEYS.MODULES.TIMER_WORSHIP.SOUND_ONE_MIN,
};

/** O som que vem com o programa, por aviso. */
export const DEFAULT_SOUNDS = {
  start: SABBATH_SCHOOL_SOUNDS.OPENING,
  five: SABBATH_SCHOOL_SOUNDS.FIVE_MINUTES,
  one: SABBATH_SCHOOL_SOUNDS.ONE_MINUTE,
} as const;

export function getSoundChoice(cue: WorshipCue): WorshipSoundChoice | null {
  const raw = $userdata.get<WorshipSoundChoice | null>(CHOICE_KEYS[cue], null);
  if (!raw || typeof raw !== "object" || !raw.libraryId) return null;
  return { libraryId: String(raw.libraryId), name: String(raw.name || "") };
}

export function setSoundChoice(cue: WorshipCue, choice: WorshipSoundChoice | null): void {
  $userdata.set(CHOICE_KEYS[cue], choice ? { ...choice } : null);
}

interface LibraryAudioRecord {
  id: string;
  name?: string;
  type?: string;
  path?: string;
  data?: Blob | ArrayBuffer | ArrayBufferView;
  mime?: string;
}

/** Uma URL viva por registro durante a sessão, sem criar outra a cada toque. */
const liveUrls = new Map<string, string>();

function urlOfRecord(rec: LibraryAudioRecord): string {
  if (rec.data && (!rec.path || rec.path.startsWith("blob:"))) {
    const cached = liveUrls.get(rec.id);
    if (cached) return cached;
    const blob =
      rec.data instanceof Blob
        ? rec.data
        : new Blob([rec.data as BlobPart], { type: rec.mime || "" });
    if (!blob.size) return "";
    const url = URL.createObjectURL(blob);
    liveUrls.set(rec.id, url);
    return url;
  }
  return $path.media(rec.path || "");
}

export interface ResolvedSound {
  url: string;
  title: string;
  /** Escolhido na biblioteca mas não achado: tocou o padrão no lugar. */
  fellBack: boolean;
}

/**
 * O que tocar para um aviso. Se o áudio escolhido sumiu da biblioteca, toca o
 * padrão — no culto, melhor o som de sempre do que silêncio.
 */
export async function resolveCueSound(
  cue: WorshipCue,
  defaultTitle: string
): Promise<ResolvedSound> {
  const fallback = { url: DEFAULT_SOUNDS[cue].url, title: defaultTitle };
  const choice = getSoundChoice(cue);
  if (!choice) return { ...fallback, fellBack: false };
  try {
    const rec = await $idb.get<LibraryAudioRecord>(DB_TABLE.MEDIA_LIBRARY, choice.libraryId);
    const url = rec ? urlOfRecord(rec) : "";
    if (url) return { url, title: rec?.name || choice.name, fellBack: false };
  } catch {
    /* cai no padrão */
  }
  return { ...fallback, fellBack: true };
}

/** Áudios da Biblioteca de Mídia, para escolher o som de um aviso. */
export async function listLibraryAudios(): Promise<{
  items: Array<{ id: string; name: string; categoryId?: string }>;
  categories: Array<{ id: string; name: string; icon?: string; iconType?: string; color?: string }>;
}> {
  const [all, categories] = await Promise.all([
    $idb
      .getAll<LibraryAudioRecord & { categoryId?: string }>(DB_TABLE.MEDIA_LIBRARY)
      .catch(() => []),
    $idb
      .getAll<{
        id: string;
        name: string;
        icon?: string;
        iconType?: string;
        color?: string;
      }>(DB_TABLE.MEDIA_LIBRARY_CATEGORY)
      .catch(() => []),
  ]);
  const items = all
    .filter((r) => r.type === "audio")
    .map((r) => ({ id: r.id, name: r.name || r.id, categoryId: r.categoryId }));
  const used = new Set(items.map((i) => i.categoryId).filter(Boolean));
  return { items, categories: categories.filter((c) => used.has(c.id)) };
}
