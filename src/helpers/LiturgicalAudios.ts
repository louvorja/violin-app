/**
 * Categoria "Litúrgicos" da Biblioteca de Mídia e o fundo musical da Oração
 * Intercessória.
 *
 * A categoria nasce na primeira vez que alguém abre a biblioteca ou um seletor
 * de áudio (`ensureLiturgicalAudios`), e não depende do boot. O que o usuário
 * apagar não volta: a lista do que já foi criado fica em UserData. A cada
 * abertura o caminho do arquivo é atualizado, porque o endereço de um asset
 * muda de uma versão do programa para outra.
 *
 * @category deve-virar-composable
 */
import { watch } from "vue";
import $idb from "@/helpers/IndexedDB";
import $path from "@/helpers/Path";
import $userdata from "@/helpers/UserData";
import $appdata from "@/helpers/AppData";
import { DB_TABLE } from "@/constants/DbTables";
import { KEYS } from "@/constants/UserDataKeys";
import { ICONS } from "@/config/Icons";
import {
  INTERCESSORY_PRAYER_ID,
  LITURGICAL_AUDIOS,
  LITURGICAL_CATEGORY,
} from "@/config/LiturgicalAudios";
import { useBackgroundSound } from "@/composables/useBackgroundSound";

interface LibraryRecord {
  id: string;
  name?: string;
  fileName?: string;
  type?: string;
  path?: string;
  data?: Blob | ArrayBuffer | ArrayBufferView;
  mime?: string;
  /** Veio com o programa: o caminho é do próprio app e é refeito a cada versão. */
  bundled?: boolean;
  [key: string]: unknown;
}

function language(): "pt" | "es" {
  return $userdata.get<string>(KEYS.OPTIONS.LANGUAGE, "pt") === "es" ? "es" : "pt";
}

function seededIds(): Set<string> {
  const raw = $userdata.get<unknown>(KEYS.MODULES.MEDIA_LIBRARY.LITURGICAL_SEEDED, []);
  return new Set(Array.isArray(raw) ? raw.map(String) : []);
}

let ensuring: Promise<void> | null = null;

/** Cria (uma vez) a categoria e os áudios; atualiza o caminho dos que existem. */
export function ensureLiturgicalAudios(): Promise<void> {
  ensuring ??= seed().catch((error) => {
    ensuring = null; // tenta de novo na próxima abertura
    console.warn("[LiturgicalAudios] não foi possível criar os áudios litúrgicos:", error);
  });
  return ensuring;
}

/** Só para os testes: esquece que já criou nesta sessão. */
export function _resetLiturgicalAudiosForTests(): void {
  ensuring = null;
}

async function seed(): Promise<void> {
  const seen = seededIds();
  const lang = language();
  const created: string[] = [];

  if (!seen.has(LITURGICAL_CATEGORY.id)) {
    const existing = await $idb.get(DB_TABLE.MEDIA_LIBRARY_CATEGORY, LITURGICAL_CATEGORY.id);
    if (!existing) {
      await $idb.put(DB_TABLE.MEDIA_LIBRARY_CATEGORY, {
        id: LITURGICAL_CATEGORY.id,
        name: LITURGICAL_CATEGORY.names[lang],
        icon: ICONS.CATEGORY.PRAY,
        iconType: "icon",
        color: LITURGICAL_CATEGORY.color,
      });
    }
    created.push(LITURGICAL_CATEGORY.id);
  }

  for (const [order, audio] of LITURGICAL_AUDIOS.entries()) {
    const record = await $idb.get<LibraryRecord>(DB_TABLE.MEDIA_LIBRARY, audio.id);
    if (record) {
      // Já existe: só acompanha o endereço do arquivo, mantendo nome e categoria do usuário.
      if (record.bundled && record.path !== audio.url) {
        await $idb.put(DB_TABLE.MEDIA_LIBRARY, { ...record, path: audio.url, id: audio.id });
      }
      continue;
    }
    if (seen.has(audio.id)) continue; // o usuário apagou
    const name = audio.credit ? `${audio.names[lang]} · ${audio.credit}` : audio.names[lang];
    await $idb.put(DB_TABLE.MEDIA_LIBRARY, {
      id: audio.id,
      name,
      path: audio.url,
      type: "audio",
      mime: "audio/mpeg",
      addedAt: Date.now(),
      categoryId: LITURGICAL_CATEGORY.id,
      order,
      bundled: true,
    });
    created.push(audio.id);
  }

  if (created.length) {
    $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.LITURGICAL_SEEDED, [...seen, ...created]);
  }
}

/* ------------------------------------------------------------------ */
/*  Fundo musical da Oração Intercessória                              */
/* ------------------------------------------------------------------ */

export interface IntercessoryBackground {
  source: "background_sound" | "media_library";
  id: string;
  name: string;
}

export function getIntercessoryBackground(): IntercessoryBackground | null {
  const raw = $userdata.get<IntercessoryBackground | null>(
    KEYS.MODULES.MEDIA_LIBRARY.INTERCESSORY_BACKGROUND,
    null
  );
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  if (raw.source !== "background_sound" && raw.source !== "media_library") return null;
  return { source: raw.source, id: String(raw.id), name: String(raw.name || "") };
}

export function setIntercessoryBackground(value: IntercessoryBackground | null): void {
  $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.INTERCESSORY_BACKGROUND, value ? { ...value } : null);
}

/** Uma URL viva por registro (o `blob:` salvo não sobrevive a fechar o app). */
const liveUrls = new Map<string, string>();

function playableUrl(record: LibraryRecord): string {
  const path = String(record.path || "");
  if (record.data && (!path || path.startsWith("blob:"))) {
    const cached = liveUrls.get(record.id);
    if (cached) return cached;
    const data = record.data;
    const blob =
      data instanceof Blob ? data : new Blob([data as BlobPart], { type: record.mime || "" });
    if (!blob.size) return "";
    const url = URL.createObjectURL(blob);
    liveUrls.set(record.id, url);
    return url;
  }
  return $path.media(path);
}

/** Toca o fundo escolhido no player do Som de Fundo (com o fade de entrada dele). */
export async function playIntercessoryBackground(
  choice: IntercessoryBackground | null = getIntercessoryBackground()
): Promise<boolean> {
  if (!choice) return false;
  const table =
    choice.source === "background_sound"
      ? DB_TABLE.BACKGROUND_SOUND_LIBRARY
      : DB_TABLE.MEDIA_LIBRARY;
  const record = await $idb.get<LibraryRecord>(table, choice.id).catch(() => undefined);
  if (!record) return false;
  const url = playableUrl(record);
  if (!url) return false;
  const name = record.fileName || record.name || choice.name;
  useBackgroundSound().playFile({ id: record.id, name, fileName: name, path: url });
  return true;
}

let followGeneration = 0;
let stopFollowing: (() => void) | null = null;

/** Quanto antes do fim conta como "terminou" (o último timeupdate chega um pouco antes). */
const END_TOLERANCE_S = 0.35;
/** Desiste de esperar depois disso — ninguém fala por mais de meia hora. */
const MAX_WAIT_MS = 30 * 60 * 1000;

/**
 * Depois de mandar um áudio da biblioteca para o player: se for a Oração
 * Intercessória e houver fundo escolhido, espera a locução terminar e entra
 * com o fundo. Se o operador trocar de áudio antes do fim, o fundo não entra.
 */
export function afterLiturgicalAudio(recordId: string | undefined | null): void {
  if (recordId !== INTERCESSORY_PRAYER_ID) return;
  const choice = getIntercessoryBackground();
  if (!choice) return;

  stopFollowing?.();
  const generation = ++followGeneration;
  let ours: string | null = null;

  // `immediate` roda o callback antes de o `watch` devolver o `unwatch`: quem
  // para nessa primeira leitura só marca, e o desligamento vem logo abaixo.
  let stopped = false;
  let unwatch: (() => void) | null = null;
  const stop = (): void => {
    stopped = true;
    unwatch?.();
    clearTimeout(timeout);
    if (stopFollowing === stop) stopFollowing = null;
  };
  const timeout = setTimeout(stop, MAX_WAIT_MS);
  unwatch = watch(
    () =>
      [
        String($appdata.get(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "") || ""),
        Number($appdata.get(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 0)) || 0,
        Number($appdata.get(KEYS.MODULES.MEDIA.CONFIG.DURATION, 0)) || 0,
      ] as const,
    ([audio, time, duration]) => {
      if (generation !== followGeneration) return stop();
      if (!audio) return;
      // O primeiro áudio que aparece no player é a locução; outro depois dele é troca.
      ours ??= audio;
      if (audio !== ours) return stop();
      if (duration > 0 && time >= duration - END_TOLERANCE_S) {
        stop();
        void playIntercessoryBackground(choice);
      }
    },
    // Síncrono: vê cada troca do player na hora, sem juntar mudanças em lote.
    { immediate: true, flush: "sync" }
  );
  if (stopped) unwatch();
  else stopFollowing = stop;
}
