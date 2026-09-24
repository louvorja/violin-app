import { ref, computed, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import Platform from "@/helpers/Platform";
import Database from "@/helpers/Database";
import $idb from "@/helpers/IndexedDB";
import $userdata from "@/helpers/UserData";
import { KEYS, moduleShowInMainMenu } from "@/constants/UserDataKeys";
import { DB_TABLE } from "@/constants/DbTables";
import type { BibleVersion } from "@/types/Bible";
import type { BundleProgress } from "@/types/Database";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import Libras from "@/helpers/Libras";
import BundleInstaller from "@/helpers/BundleInstaller";
import BibleBundleInstaller from "@/helpers/BibleBundleInstaller";
import { formatBackgroundTaskDetail } from "@/helpers/BackgroundTaskDetail";
import type { Music } from "@/types/Music";
import type { BibleBook } from "@/types/Bible";
import { resolveMediaReference } from "@/helpers/MediaUrl";

interface FileEntry {
  remote: string;
  remoteUrl?: string;
  local: string;
  expectedSize: number;
}

interface MusicLine {
  url_image?: string;
}

interface MusicData {
  url_music?: string;
  url_instrumental_music?: string;
  url_image?: string;
  lyric?: MusicLine[];
  musics?: Array<{ id_music: number | string }>;
}

interface DiskUsage {
  bytes: number;
  fileCount: number;
  albumCount: number;
  hymnalCached: boolean;
}

interface StorageSizeResult {
  bytes: number;
  count: number;
}

/** De onde cada arquivo pode ser lido: pasta do app, acervo clássico, ou lugar nenhum. */
type FileOrigin = "own" | "classic" | false;

interface LocalCheckResult {
  [remote: string]: FileOrigin;
}

type CleanupFn = () => void;

export interface ScanResult {
  cachedAlbums: Set<number>;
  classicAlbums: Set<number>;
  hymnalCached: boolean;
  downloadedBibles: number[];
  connectionOk: boolean;
  albumsTotal: number;
  bibleVersions: BibleVersion[];
}

// Estado da conexão vive no módulo, não na instância: a tela de Sincronizar é
// destruída ao fechar o menu e reabrí-la não deve disparar outra ida à rede.
const ftpOk = ref(false);
const ftpChecking = ref(false);
const ftpError = ref("");
let ftpOkUntil = 0;
let ftpInflight: Promise<boolean> | null = null;

/** Por quanto tempo uma conexão confirmada é considerada válida. */
const FTP_OK_TTL_MS = 60_000;

interface ScanCacheResult {
  cachedAlbums: Set<number>;
  /** Subconjunto de `cachedAlbums` que só está completo graças ao acervo clássico. */
  classicAlbums: Set<number>;
  hymnalCached: boolean;
  hymnal1996Cached: boolean;
}

export interface CatalogScanResult extends ScanCacheResult {
  categories: any[];
  hymnalIds: number[];
  hymnal1996Ids: number[];
  bibleVersions: BibleVersion[];
  downloadedBibles: number[];
  /** Há um bundle geral concluído no armazenamento local. */
  catalogAvailable: boolean;
  /** O usuário autorizou e concluiu a leitura detalhada do catálogo local. */
  detailed: boolean;
}

interface CatalogReadOptions {
  fresh?: boolean;
  localOnly?: boolean;
}

// O que está no disco só muda por ação do próprio app, então o resultado do
// scan é reaproveitado entre aberturas da tela e invalidado em cada escrita.
let scanCacheEntry: { lang: string; at: number; result: ScanCacheResult } | null = null;
const SCAN_CACHE_TTL_MS = 5 * 60_000;

// A verificação inicial e a tela de Sincronizar podem instanciar este
// composable ao mesmo tempo. Compartilhar a operação evita que as duas
// instâncias baixem os mesmos capítulos.
let activeBibleDownload: Promise<number> | null = null;
let activeBibleCancel: (() => void) | null = null;

// O bundle é compartilhado entre a Bíblia, a busca bíblica e as telas de
// Atualizações. Assim, abrir duas dessas telas não inicia dois downloads nem
// perde o progresso de quem entrou depois.
const bundleInstalling = ref(false);
const bundleProgress = ref<BundleProgress>({ phase: "download", current: 0, total: 0 });
let activeBundleDownload: Promise<boolean> | null = null;
// O bundle geral já contém a Bíblia; o bundle bíblico não contém o catálogo.
let activeBundleKind: "full" | "bible" | null = null;
let activeBundleAbort: AbortController | null = null;
let bundleReady = false;
let bundleEnsurePromise: Promise<boolean> | null = null;
let bundleFailedAt = 0;
let catalogReady = false;
let catalogEnsurePromise: Promise<boolean> | null = null;
let catalogFailedAt = 0;

// Depois de uma falha, reabrir a tela bíblica não recomeça o download de 25 MB
// na hora: numa rede que soluça, cada abertura seria uma nova tentativa do zero.
const BUNDLE_RETRY_COOLDOWN_MS = 5 * 60_000;

// Cada fase reportava o próprio 0→100 (baixar, extrair, gravar). A barra chegava
// a 100% e voltava a 0% — e, valendo 0, as telas a desenhavam como
// "indeterminada". Um percentual só, com um trecho fixo por fase, nunca recua.
const BUNDLE_PHASE_SPAN: Record<BundleProgress["phase"], readonly [number, number]> = {
  download: [0, 70],
  extract: [70, 80],
  inject: [80, 100],
};

export function bundlePercentOf(p: BundleProgress): number {
  const [from, to] = BUNDLE_PHASE_SPAN[p.phase];
  let done = 0;
  if (p.phase === "download") {
    const total = p.bytesTotal ?? 0;
    if (total > 0) done = (p.bytesReceived ?? p.current) / total;
  } else if (p.total > 0) {
    done = p.current / p.total;
  }
  return Math.round(from + Math.min(1, Math.max(0, done)) * (to - from));
}

const bundlePercent = computed<number>(() => bundlePercentOf(bundleProgress.value));

// Sobe sempre que o conteúdo bíblico local muda (bundle instalado, versões
// baixadas ou removidas). As telas que mostram "o que está baixado" — Bíblia e
// Sincronizar — releem quando ele muda, em vez de ficar com a foto de quando
// abriram.
const bibleRevision = ref(0);
function bumpBibleRevision(): void {
  bibleRevision.value += 1;
}

export function useSyncManager() {
  const { t, locale } = useI18n();
  const bgTasks = useBackgroundTasks();

  // Scan
  const scanning = ref(false);
  const scanProgress = ref({ done: 0, total: 0 });

  // Download (collections)
  const downloading = ref(false);
  const downloadProgress = ref({ done: 0, failed: 0, total: 0, currentFile: "" });
  const downloadFailedCount = ref(0);
  const downloadCompletedMsg = ref("");

  // Bible download
  const bibleDownloading = ref(false);
  const bibleCancelled = ref(false);
  const bibleProgress = ref({ done: 0, total: 0, currentFile: "" });
  const bibleCompletedMsg = ref("");

  let _downloadCleanup: CleanupFn[] = [];

  // ─── FTP ────────────────────────────────────────────────────────

  /**
   * @param force ignora o resultado em cache (botão "Verificar conexão").
   * Só o sucesso é cacheado — estando offline, cada abertura tenta de novo.
   */
  async function checkFtp(force = false): Promise<boolean> {
    if (!Platform.download) {
      console.warn("[useSyncManager] checkFtp → Platform.download é null (web/PWA?)");
      return false;
    }
    if (!force && ftpOk.value && Date.now() < ftpOkUntil) return true;
    if (ftpInflight) return ftpInflight;

    ftpInflight = runFtpCheck();
    try {
      return await ftpInflight;
    } finally {
      ftpInflight = null;
    }
  }

  async function runFtpCheck(): Promise<boolean> {
    const download = Platform.download!;
    ftpChecking.value = true;
    ftpOk.value = false;
    ftpError.value = "";
    try {
      console.info("[useSyncManager] checkFtp → chamando checkConnection...");
      const r = (await download.checkConnection()) as {
        ok: boolean;
        host?: string;
        msg?: string;
        error?: string;
      };
      console.info("[useSyncManager] checkFtp → resultado:", r);
      if (r.ok) {
        ftpOk.value = true;
        if (r.msg) {
          ftpOk.value = false;
          ftpError.value = r.msg;
        }
      } else {
        ftpError.value = r.error || "Disconnected";
      }
    } catch (e) {
      console.error("[useSyncManager] checkFtp → exceção:", e);
      ftpError.value = (e as Error).message;
    } finally {
      ftpChecking.value = false;
      ftpOkUntil = ftpOk.value ? Date.now() + FTP_OK_TTL_MS : 0;
    }
    return ftpOk.value;
  }

  // ─── Catalog / Scan ─────────────────────────────────────────────

  async function loadCatalog(
    lang: string,
    { fresh = false, localOnly = false }: CatalogReadOptions = {}
  ): Promise<{ categories: any[]; hymnalIds: number[]; hymnal1996Ids: number[] }> {
    const read = <T>(key: string, silent = false): Promise<T | null> =>
      localOnly ? Database.getLocal<T>(key) : Database.get<T>(key, { fresh, silent });
    const hymnal1996Enabled =
      $userdata.get<boolean>(moduleShowInMainMenu("hymnal_1996"), false) === true;
    const [catsRes, hymRes, hym1996Res] = await Promise.allSettled([
      read(`${lang}_categories`),
      read(`${lang}_hymnal`),
      hymnal1996Enabled ? read(`${lang}_hymnal_1996`) : Promise.resolve(null),
    ]);
    const categories: any[] = [];
    let hymnalIds: number[] = [];
    let hymnal1996Ids: number[] = [];

    if (catsRes.status === "fulfilled" && Array.isArray(catsRes.value)) {
      categories.push(...(catsRes.value as any[]).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    }
    if (hymRes.status === "fulfilled" && Array.isArray(hymRes.value)) {
      hymnalIds = (hymRes.value as Array<{ id_music: number | string }>)
        .map((m) => Number(m.id_music))
        .filter((n) => Number.isFinite(n));
    }
    if (hym1996Res.status === "fulfilled" && Array.isArray(hym1996Res.value)) {
      hymnal1996Ids = (hym1996Res.value as Array<{ id_music: number | string }>)
        .map((m) => Number(m.id_music))
        .filter((n) => Number.isFinite(n));
    }

    // Doxologia — categoria virtual com os álbuns da rota por slug
    // ({lang}_doxology_albums). Injetada aqui, flui automaticamente para
    // Sincronizar, check inicial, scan de cache, download e uso em disco.
    try {
      const dox = await read<Array<{ id_album: number | string; name: string }>>(
        `${lang}_doxology_albums`,
        true
      );
      if (Array.isArray(dox) && dox.length > 0) {
        categories.push({
          id_category: -1,
          name: "Doxologia",
          order: 9999,
          albums: dox.map((a) => ({ id_album: Number(a.id_album), name: a.name })),
        });
      }
    } catch {
      /* doxologia indisponível — segue sem a seção */
    }

    return { categories, hymnalIds, hymnal1996Ids };
  }

  async function scanCache(
    lang: string,
    categories: any[],
    hymnalIds: number[],
    hymnal1996Ids: number[] = [],
    { force = false }: { force?: boolean } = {}
  ): Promise<ScanCacheResult> {
    if (!Platform.storage?.checkLocal) {
      return {
        cachedAlbums: new Set(),
        classicAlbums: new Set(),
        hymnalCached: false,
        hymnal1996Cached: false,
      };
    }

    if (
      !force &&
      scanCacheEntry?.lang === lang &&
      Date.now() - scanCacheEntry.at < SCAN_CACHE_TTL_MS
    ) {
      return cloneScanResult(scanCacheEntry.result);
    }

    const albumIds: number[] = [];
    categories.forEach((cat: any) => {
      cat.albums?.forEach((a: any) => albumIds.push(a.id_album));
    });

    const totalSteps =
      albumIds.length + (hymnalIds.length ? 1 : 0) + (hymnal1996Ids.length ? 1 : 0);
    if (totalSteps === 0)
      return {
        cachedAlbums: new Set(),
        classicAlbums: new Set(),
        hymnalCached: false,
        hymnal1996Cached: false,
      };

    // O scan nunca instala nada. Sem um catálogo concluído no disco, abrir cada
    // álbum/música viraria milhares de GETs; a tela oferece a instalação como
    // uma ação explícita e este caminho retorna um estado vazio recuperável.
    if (!(await hasCatalogForBulkRead())) {
      return {
        cachedAlbums: new Set(),
        classicAlbums: new Set(),
        hymnalCached: false,
        hymnal1996Cached: false,
      };
    }

    scanning.value = true;
    scanProgress.value = { done: 0, total: totalSteps };

    const cachedAlbums = new Set<number>();
    const classicAlbums = new Set<number>();
    const ALBUM_BATCH = 3;

    for (let i = 0; i < albumIds.length; i += ALBUM_BATCH) {
      const slice = albumIds.slice(i, i + ALBUM_BATCH);
      await Promise.all(
        slice.map(async (id) => {
          try {
            const files = await collectAlbumFileList(id, { localOnly: true });
            if (files.length === 0) return;
            const origem = await originOfFileList(files);
            if (origem) cachedAlbums.add(id);
            if (origem === "classic") classicAlbums.add(id);
          } catch (e) {
            console.warn(`[useSyncManager] scan album ${id}:`, e);
          } finally {
            scanProgress.value = { ...scanProgress.value, done: scanProgress.value.done + 1 };
          }
        })
      );
    }

    let hymnalCached = false;
    if (hymnalIds.length) {
      try {
        const hymFiles = await collectHymnalFileList(hymnalIds, { localOnly: true });
        hymnalCached = hymFiles.length > 0 && (await isFileListComplete(hymFiles));
      } catch (e) {
        console.warn("[useSyncManager] scan hymnal:", e);
      }
      scanProgress.value = { ...scanProgress.value, done: scanProgress.value.done + 1 };
    }

    let hymnal1996Cached = false;
    if (hymnal1996Ids.length) {
      try {
        const hymFiles = await collectHymnalFileList(hymnal1996Ids, { localOnly: true });
        hymnal1996Cached = hymFiles.length > 0 && (await isFileListComplete(hymFiles));
      } catch (e) {
        console.warn("[useSyncManager] scan hymnal 1996:", e);
      }
      scanProgress.value = { ...scanProgress.value, done: scanProgress.value.done + 1 };
    }

    scanning.value = false;
    const result: ScanCacheResult = {
      cachedAlbums,
      classicAlbums,
      hymnalCached,
      hymnal1996Cached,
    };
    scanCacheEntry = { lang, at: Date.now(), result: cloneScanResult(result) };
    return result;
  }

  /** O chamador marca/desmarca álbuns sobre o Set devolvido — nunca entregue o
   *  mesmo objeto que ficou guardado. */
  function cloneScanResult(r: ScanCacheResult): ScanCacheResult {
    return {
      ...r,
      cachedAlbums: new Set(r.cachedAlbums),
      classicAlbums: new Set(r.classicAlbums),
    };
  }

  function invalidateScanCache(): void {
    scanCacheEntry = null;
  }

  function emptyCatalogScan(catalogAvailable: boolean): CatalogScanResult {
    return {
      categories: [],
      hymnalIds: [],
      hymnal1996Ids: [],
      cachedAlbums: new Set(),
      classicAlbums: new Set(),
      hymnalCached: false,
      hymnal1996Cached: false,
      bibleVersions: [],
      downloadedBibles: [],
      catalogAvailable,
      detailed: false,
    };
  }

  /**
   * A abertura automática faz somente a checagem local do marker. O scan
   * detalhado abre milhares de registros de álbum/música e, por isso, só roda
   * depois de uma ação explícita da pessoa na tela.
   */
  async function runScan(
    lang: string,
    { detailed = false }: { detailed?: boolean } = {}
  ): Promise<CatalogScanResult> {
    const catalogAvailable = await hasCatalogForBulkRead();
    if (!detailed || !catalogAvailable) return emptyCatalogScan(catalogAvailable);

    scanning.value = true;
    try {
      // No desktop, uma varredura detalhada é estritamente local. Mesmo que um
      // marker antigo tenha sobrevivido a uma corrupção parcial, o boot nunca
      // transforma a falta de uma linha em rajada de rede.
      const localOnly = !!Platform.storage?.checkLocal;
      const { categories, hymnalIds, hymnal1996Ids } = await loadCatalog(lang, { localOnly });
      const { versions: bibleVersions } = await loadBibleVersions(lang, { localOnly });
      const { cachedAlbums, classicAlbums, hymnalCached, hymnal1996Cached } = await scanCache(
        lang,
        categories,
        hymnalIds,
        hymnal1996Ids
      );

      if (bibleVersions.length > 0) {
        scanProgress.value = {
          ...scanProgress.value,
          total: scanProgress.value.total + bibleVersions.length,
        };
      }

      const downloadedBibles = await scanBibleVersionsDisk(bibleVersions, lang, {
        trackProgress: true,
        localOnly,
      });

      return {
        categories,
        hymnalIds,
        hymnal1996Ids,
        cachedAlbums,
        classicAlbums,
        hymnalCached,
        hymnal1996Cached,
        bibleVersions,
        downloadedBibles,
        catalogAvailable: true,
        detailed: true,
      };
    } finally {
      scanning.value = false;
    }
  }

  // ─── Bible Versions ─────────────────────────────────────────────

  async function loadBibleVersions(
    lang: string,
    { localOnly = false }: { localOnly?: boolean } = {}
  ): Promise<{ versions: BibleVersion[]; downloaded: number[] }> {
    let versions: BibleVersion[] = [];
    try {
      const data = localOnly
        ? await Database.getLocal<BibleVersion[]>(`${lang}_bible_version`)
        : await Database.get<BibleVersion[]>(`${lang}_bible_version`);
      if (data) versions = data;
    } catch (e) {
      console.error("[useSyncManager] loadBibleVersions:", e);
    }

    const saved = $userdata.get<number[]>(KEYS.STORAGE.BIBLE_DOWNLOADED_VERSIONS);
    return { versions, downloaded: saved || [] };
  }

  async function scanBibleVersionsDisk(
    versions: BibleVersion[],
    lang: string,
    {
      trackProgress = false,
      localOnly = false,
    }: { trackProgress?: boolean; localOnly?: boolean } = {}
  ): Promise<number[]> {
    if (!versions.length) return [];
    const books = localOnly
      ? await Database.getLocal<Array<{ id_bible_book: number; chapters?: number }>>(
          `${lang}_bible_book`
        )
      : await Database.get<Array<{ id_bible_book: number; chapters?: number }>>(
          `${lang}_bible_book`
        );
    if (!books || books.length === 0) return [];

    const downloaded: number[] = [];
    // Capítulos presentes no IndexedDB (bundle completo + downloads em
    // runtime). O disco (userData/json_db) continua valendo como
    // complemento para usuários legados.
    const stored = new Map<number, Set<string>>();
    const loadStored = async (versionId: number): Promise<Set<string>> => {
      if (!stored.has(versionId)) {
        stored.set(
          versionId,
          await Database.getStoredIdsForPrefix(DB_TABLE.BIBLE_CHAPTERS, `bible_${versionId}_`)
        );
      }
      return stored.get(versionId)!;
    };

    for (const ver of versions) {
      const allKeys: string[] = [];
      for (const book of books) {
        const n = book.chapters ?? 1;
        for (let i = 1; i <= n; i++) {
          allKeys.push(`bible_${ver.id_bible_version}_${book.id_bible_book}_${i}`);
        }
      }

      try {
        const inIdb = await loadStored(ver.id_bible_version);
        if ((Platform.storage as any)?.checkJson) {
          const exists = (await (Platform.storage as any).checkJson(allKeys)) as Record<
            string,
            boolean
          >;
          if (allKeys.every((k) => exists[k] || inIdb.has(k))) {
            downloaded.push(ver.id_bible_version);
          }
        } else if (allKeys.every((k) => inIdb.has(k))) {
          downloaded.push(ver.id_bible_version);
        }
      } catch (e) {
        console.warn(`[useSyncManager] scan bible version ${ver.id_bible_version}:`, e);
      }

      // `scanProgress` é do scan de coletâneas: a aba Bíblia, que chama isto por
      // conta própria, deixava a tela do scan em "(10/0)".
      if (trackProgress) {
        scanProgress.value = { ...scanProgress.value, done: scanProgress.value.done + 1 };
      }
    }

    return downloaded;
  }

  async function downloadBibleVersions(
    versionIds: number[],
    bibleVersions: BibleVersion[],
    lang: string
  ): Promise<number> {
    if (versionIds.length === 0) return 0;

    if (activeBibleDownload) return activeBibleDownload;
    const pending = downloadBibleVersionsInternal(versionIds, bibleVersions, lang);
    activeBibleDownload = pending;
    try {
      return await pending;
    } finally {
      if (activeBibleDownload === pending) activeBibleDownload = null;
      activeBibleCancel = null;
    }
  }

  async function downloadBibleVersionsInternal(
    versionIds: number[],
    bibleVersions: BibleVersion[],
    lang: string
  ): Promise<number> {
    bibleDownloading.value = true;
    bibleCancelled.value = false;
    activeBibleCancel = () => {
      bibleCancelled.value = true;
    };
    bibleProgress.value = { done: 0, total: 0, currentFile: "" };
    bibleCompletedMsg.value = "";

    bgTasks.registerTask("sync-bible", "startup_check.task.bible", () => {
      bibleCancelled.value = true;
    });

    // Um GET traz os capítulos de todas as versões. Sem isso, "baixar tudo"
    // abria uma requisição por capítulo (~1.200 por versão). O laço abaixo só
    // trabalha de verdade se o bundle não estiver disponível.
    // A revisão só sobe quando um download acontece: "já estava instalado" não conta.
    const revisionBefore = bibleRevision.value;
    const stopMirroring = watch(
      bundlePercent,
      (pct) => {
        if (!bundleInstalling.value) return;
        bibleProgress.value = { done: pct, total: 100, currentFile: "" };
        bgTasks.updateTask("sync-bible", { progress: pct });
      },
      { immediate: true }
    );
    try {
      await ensureBibleBundle();
    } finally {
      stopMirroring();
    }
    const installedNow = bibleRevision.value !== revisionBefore;

    const books = await Database.get<Array<{ id_bible_book: number; chapters?: number }>>(
      `${lang}_bible_book`
    );
    if (!books || books.length === 0) {
      bibleCompletedMsg.value = "Nenhum livro encontrado.";
      bibleDownloading.value = false;
      bgTasks.updateTask("sync-bible", { status: "error" });
      return 0;
    }

    const allChapters: { versionId: number; bookId: number; n: number }[] = [];
    for (const vId of versionIds) {
      for (const book of books) {
        const n = book.chapters ?? 1;
        for (let i = 1; i <= n; i++) {
          allChapters.push({ versionId: vId, bookId: book.id_bible_book, n: i });
        }
      }
    }

    const allKeys = allChapters.map((c) => `bible_${c.versionId}_${c.bookId}_${c.n}`);
    // Capítulos já presentes no IndexedDB não são rebaixados.
    const storedByVersion = new Map<number, Set<string>>();
    for (const vId of versionIds) {
      storedByVersion.set(
        vId,
        await Database.getStoredIdsForPrefix(DB_TABLE.BIBLE_CHAPTERS, `bible_${vId}_`)
      );
    }
    let toDownload = allChapters;

    if ((Platform.storage as any)?.checkJson) {
      const exists = (await (Platform.storage as any).checkJson(allKeys)) as Record<
        string,
        boolean
      >;
      toDownload = allChapters.filter((c) => {
        const k = `bible_${c.versionId}_${c.bookId}_${c.n}`;
        return !exists[k] && !storedByVersion.get(c.versionId)?.has(k);
      });
    } else {
      toDownload = allChapters.filter(
        (c) => !storedByVersion.get(c.versionId)?.has(`bible_${c.versionId}_${c.bookId}_${c.n}`)
      );
    }

    bibleProgress.value = { ...bibleProgress.value, total: toDownload.length };

    if (toDownload.length === 0) {
      bibleDownloading.value = false;
      bibleCompletedMsg.value = installedNow ? "" : "Nada a baixar (já está em cache).";
      const previous = $userdata.get<number[]>(KEYS.STORAGE.BIBLE_DOWNLOADED_VERSIONS, []) || [];
      $userdata.set(KEYS.STORAGE.BIBLE_DOWNLOADED_VERSIONS, [
        ...new Set([...previous.filter((id) => !versionIds.includes(id)), ...versionIds]),
      ]);
      // Sem isto a tarefa ficava "em andamento" para sempre: a aba da Bíblia
      // continuava desenhando o progresso e escondia o botão de baixar.
      bgTasks.completeTask("sync-bible");
      bumpBibleRevision();
      return installedNow ? allChapters.length : 0;
    }

    // O download é uma tarefa de fundo, mas cada capítulo ainda passa pelo
    // renderer → protocolo Electron → rede → IndexedDB. Quatro operações
    // simultâneas preservam avanço perceptível sem formar uma rajada de
    // conexões/transações, em qualquer equipamento.
    const batchSize = 4;
    let completed = 0;
    const failedKeys = new Set<string>();
    for (let i = 0; i < toDownload.length && !bibleCancelled.value; i += batchSize) {
      const batch = toDownload.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ch) => {
          const key = `bible_${ch.versionId}_${ch.bookId}_${ch.n}`;
          const detail = formatBackgroundTaskDetail(key, t, bibleVersions);
          bibleProgress.value = { ...bibleProgress.value, currentFile: detail || key };
          try {
            // A lista já foi filtrada pelo cache local. A leitura normal
            // compartilha o mesmo in-flight com a Bíblia e não cria outra
            // requisição por causa de `fresh`.
            const data = await Database.get(key, { silent: true });
            if (data === null) failedKeys.add(key);
          } catch (e) {
            failedKeys.add(key);
            console.warn(`[useSyncManager] falha ao baixar ${key}:`, e);
          }
          completed += 1;
          bibleProgress.value = { ...bibleProgress.value, done: completed };
          bgTasks.updateTask("sync-bible", {
            progress: toDownload.length > 0 ? Math.round((completed / toDownload.length) * 100) : 0,
            detail: detail || key,
          });
        })
      );
    }

    bibleProgress.value = { ...bibleProgress.value, currentFile: "" };
    bibleDownloading.value = false;
    if (bibleCancelled.value) {
      bibleCompletedMsg.value = "";
      bibleCancelled.value = false;
      bgTasks.updateTask("sync-bible", { status: "cancelled" });
    } else {
      const completedVersionIds = versionIds.filter(
        (versionId) =>
          !toDownload.some(
            (chapter) =>
              chapter.versionId === versionId &&
              failedKeys.has(`bible_${chapter.versionId}_${chapter.bookId}_${chapter.n}`)
          )
      );
      const previous = $userdata.get<number[]>(KEYS.STORAGE.BIBLE_DOWNLOADED_VERSIONS, []) || [];
      $userdata.set(KEYS.STORAGE.BIBLE_DOWNLOADED_VERSIONS, [
        ...new Set([...previous.filter((id) => !versionIds.includes(id)), ...completedVersionIds]),
      ]);
      bgTasks.completeTask("sync-bible");
    }
    bumpBibleRevision();
    return bibleProgress.value.done;
  }

  async function saveBibleSelectionToDisk(toRemove: number[]): Promise<void> {
    try {
      await removeBibleVersions(toRemove);
    } finally {
      bumpBibleRevision();
    }
  }

  async function removeBibleVersions(toRemove: number[]): Promise<void> {
    for (const versionId of toRemove) {
      const prefix = `bible_${versionId}_`;
      // Remove do disco legado (userData/json_db/*.json).
      if ((Platform.storage as any)?.removeJsonByPrefix) {
        await (Platform.storage as any).removeJsonByPrefix(prefix);
      }
      // Remove do IndexedDB (tabela bible_chapters).
      const ids = await Database.getStoredIdsForPrefix(DB_TABLE.BIBLE_CHAPTERS, prefix);
      for (const id of ids) {
        await $idb.del(DB_TABLE.BIBLE_CHAPTERS, id);
      }
    }
  }

  // ─── Collections Download ───────────────────────────────────────

  async function collectFiles(
    selectedAlbums: Set<number>,
    selectedHymnal: boolean,
    hymnalIds: number[],
    selectedHymnal1996 = false,
    hymnal1996Ids: number[] = []
  ): Promise<FileEntry[]> {
    const files = new Map<string, FileEntry>();
    const albumIds = [...selectedAlbums];
    const allMusicIds = new Set<number>();

    // Álbuns desativados pelo usuário não devem ser baixados.
    const disabled = $userdata.get<number[]>(KEYS.OPTIONS.DISABLED_ALBUMS, []) || [];

    await Promise.all(
      albumIds
        .filter((id) => !disabled.includes(Number(id)))
        .map(async (id) => {
          const album = await fetchJson<MusicData>(`album_${id}`);
          if (!album) return;
          const f = toFile(album.url_image);
          if (f) files.set(f.remote, f);
          album.musics?.forEach((m) => allMusicIds.add(Number(m.id_music)));
        })
    );

    if (selectedHymnal) {
      hymnalIds.forEach((id) => allMusicIds.add(id));
    }

    if (selectedHymnal1996) {
      hymnal1996Ids.forEach((id) => allMusicIds.add(id));
    }

    const musicIds = [...allMusicIds];
    await collectMusicFiles(musicIds, files);

    return [...files.values()];
  }

  async function collectAlbumFileList(
    albumId: number,
    { localOnly = false }: { localOnly?: boolean } = {}
  ): Promise<FileEntry[]> {
    const files = new Map<string, FileEntry>();
    const album = await fetchJson<MusicData>(`album_${albumId}`, { localOnly });
    if (!album) return [];
    const f = toFile(album.url_image);
    if (f) files.set(f.remote, f);
    const musicIds = (album.musics || [])
      .map((m) => Number(m.id_music))
      .filter((n) => Number.isFinite(n));
    await collectMusicFiles(musicIds, files, { localOnly });
    return [...files.values()];
  }

  async function collectHymnalFileList(
    hymnalIds: number[],
    { localOnly = false }: { localOnly?: boolean } = {}
  ): Promise<FileEntry[]> {
    const files = new Map<string, FileEntry>();
    await collectMusicFiles(hymnalIds, files, { localOnly });
    return [...files.values()];
  }

  async function collectMusicFiles(
    musicIds: number[],
    files: Map<string, FileEntry>,
    { localOnly = false }: { localOnly?: boolean } = {}
  ): Promise<void> {
    // `scanCache` pode chamar esta função para até três álbuns ao mesmo tempo.
    // Um lote fixo de quatro limita a rajada de leitura e persistência no IDB
    // para todos os equipamentos.
    const BATCH = 4;
    for (let i = 0; i < musicIds.length; i += BATCH) {
      const slice = musicIds.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (mid) => {
          const m = await fetchJson<MusicData>(`music_${mid}`, { localOnly });
          addMusicToFileMap(m, files);
        })
      );
    }
  }

  function addMusicToFileMap(m: MusicData | null | undefined, files: Map<string, FileEntry>): void {
    if (!m) return;
    [m.url_music, m.url_instrumental_music, m.url_image].forEach((u) => {
      const f = toFile(u);
      if (f) files.set(f.remote, f);
    });
    m.lyric?.forEach((line: MusicLine) => {
      const f = toFile(line.url_image);
      if (f) files.set(f.remote, f);
    });
  }

  function toFile(url: string | null | undefined): FileEntry | null {
    const reference = resolveMediaReference(url);
    if (!reference) return null;
    return {
      remote: reference.relativePath,
      remoteUrl: reference.url,
      local: reference.relativePath.slice(1),
      expectedSize: 0,
    };
  }

  async function fetchJson<T = MusicData>(
    key: string,
    { localOnly = false }: { localOnly?: boolean } = {}
  ): Promise<T | null> {
    return localOnly ? Database.getLocal<T>(key) : Database.get<T>(key);
  }

  /**
   * Um álbum inteiro disponível no acervo da versão clássica está completo do
   * mesmo jeito: o operador consegue tocar tudo, e propor download seria pedir
   * que ele baixe de novo o que já tem no disco.
   */
  async function isFileListComplete(files: FileEntry[]): Promise<boolean> {
    if (!files.length || !Platform.storage?.checkLocal) return false;
    const remotes = files.map((f) => f.remote);
    const local = (await Platform.storage.checkLocal(remotes)) as LocalCheckResult;
    return remotes.every((r) => local[r] === "own" || local[r] === "classic");
  }

  /**
   * A origem predominante de uma lista: "classic" só quando algum arquivo vem
   * de lá, para a interface poder marcar o álbum como acervo da versão antiga
   * e não oferecer um botão de remover que não removeria nada.
   */
  async function originOfFileList(files: FileEntry[]): Promise<FileOrigin> {
    if (!files.length || !Platform.storage?.checkLocal) return false;
    const remotes = files.map((f) => f.remote);
    const local = (await Platform.storage.checkLocal(remotes)) as LocalCheckResult;
    if (!remotes.every((r) => local[r] === "own" || local[r] === "classic")) return false;
    return remotes.some((r) => local[r] === "classic") ? "classic" : "own";
  }

  async function removeFilesFromCache(files: FileEntry[]): Promise<void> {
    if (!files.length || !Platform.storage?.removeFiles) return;
    await Platform.storage.removeFiles(files.map((f) => f.remote));
    invalidateScanCache();
  }

  async function startDownloads(files: FileEntry[]): Promise<void> {
    if (!Platform.download || files.length === 0) return;
    invalidateScanCache();

    downloading.value = true;
    downloadProgress.value = { done: 0, failed: 0, total: files.length, currentFile: "" };
    downloadFailedCount.value = 0;
    downloadCompletedMsg.value = "";

    bgTasks.registerTask("sync-collections", "startup_check.task.collections", () => {
      Platform.download?.cancel();
    });

    const cleanupFns: CleanupFn[] = [];

    cleanupFns.push(
      Platform.download.onProgress((d: any) => {
        downloadProgress.value = {
          ...downloadProgress.value,
          currentFile: d.file ? (d.file.split("/").pop() ?? "") : "",
        };
      })
    );
    cleanupFns.push(
      Platform.download.onFileDone(() => {
        downloadProgress.value = {
          ...downloadProgress.value,
          done: downloadProgress.value.done + 1,
        };
      })
    );
    cleanupFns.push(
      Platform.download.onFileError(() => {
        downloadFailedCount.value += 1;
        downloadProgress.value = {
          ...downloadProgress.value,
          failed: downloadProgress.value.failed + 1,
        };
      })
    );

    _downloadCleanup.push(...cleanupFns);

    // Escuta conclusão da fila
    _downloadCleanup.push(
      Platform.download.onQueueDone((result: { downloaded?: number; failed?: number; error?: string }) => {
        downloading.value = false;
        const reportedFailed = typeof result?.failed === "number" &&
          Number.isSafeInteger(result.failed) && result.failed > 0 ? result.failed : 0;
        const failed = Math.max(downloadProgress.value.failed, reportedFailed);
        downloadFailedCount.value = Math.max(downloadFailedCount.value, failed);
        downloadProgress.value = {
          ...downloadProgress.value,
          failed: Math.max(downloadProgress.value.failed, failed),
        };
        if (failed > 0) {
          downloadCompletedMsg.value = t("options.collections_download.failed", { n: failed });
          bgTasks.updateTask("sync-collections", { status: "error", completedAt: Date.now() });
          const code = typeof result?.error === "string" && /^download_worker_[a-z_]{1,48}$/.test(result.error)
            ? result.error : "file_error";
          // Telemetria é opcional no boot e nunca atrasa nem substitui o aviso
          // funcional de erro, inclusive quando o renderer ainda está montando.
          void import("@/helpers/Telemetry").then(({ default: Telemetry }) => {
            Telemetry.track("download_queue_failed", { code, failed_count: failed });
          }).catch(() => {});
        } else {
          bgTasks.completeTask("sync-collections");
        }
      })
    );
    _downloadCleanup.push(
      Platform.download.onQueueCancelled(() => {
        downloading.value = false;
        bgTasks.updateTask("sync-collections", { status: "cancelled" });
      })
    );

    try {
      const result = (await Platform.download.start(files)) as
        | { queued?: number; message?: string; downloaded?: number; failed?: number }
        | undefined;
      if (result?.queued === 0) {
        downloading.value = false;
        downloadCompletedMsg.value = result.message || "Já está atualizado.";
      } else if (result?.queued != null) {
        downloadProgress.value = { ...downloadProgress.value, total: result.queued };
      }
    } catch (e) {
      downloading.value = false;
      downloadCompletedMsg.value = (e as Error).message;
    }
  }

  async function waitForDownloadQueue(): Promise<void> {
    if (!downloading.value) return;
    return new Promise<void>((resolve) => {
      let unsubDone: CleanupFn | null = null;
      let unsubCancel: CleanupFn | null = null;
      const done = () => {
        unsubDone?.();
        unsubCancel?.();
        resolve();
      };
      unsubDone = Platform.download!.onQueueDone(done);
      unsubCancel = Platform.download!.onQueueCancelled(done);
    });
  }

  function cancelDownloads(): void {
    Platform.download?.cancel();
    if (activeBibleCancel) activeBibleCancel();
    else bibleCancelled.value = true;
  }

  // ─── Bundle Download ────────────────────────────────────────

  async function downloadBundle(
    opts: { force?: boolean; version?: number; bibleOnly?: boolean } = {}
  ): Promise<boolean> {
    const kind = opts.bibleOnly ? "bible" : "full";
    while (activeBundleDownload) {
      if (activeBundleKind === "full" || activeBundleKind === kind) return activeBundleDownload;
      // Quem pediu o banco completo não pode se dar por satisfeito com o
      // bundle só da Bíblia que já está descendo: espera e baixa o seu.
      await activeBundleDownload.catch(() => false);
    }
    const pending = downloadBundleInternal(opts);
    activeBundleDownload = pending;
    activeBundleKind = kind;
    try {
      return await pending;
    } finally {
      if (activeBundleDownload === pending) {
        activeBundleDownload = null;
        activeBundleKind = null;
      }
    }
  }

  async function downloadBundleInternal(
    opts: { force?: boolean; version?: number; bibleOnly?: boolean } = {}
  ): Promise<boolean> {
    if (bundleInstalling.value) return false;

    bundleInstalling.value = true;
    bundleProgress.value = {
      phase: "download",
      current: 0,
      total: 0,
      bytesReceived: 0,
      bytesTotal: 0,
    };
    activeBundleAbort = new AbortController();
    const signal = activeBundleAbort.signal;

    const taskId = "db-bundle";
    bgTasks.registerTask(taskId, "shell.background_tasks.db_bundle", () => {
      activeBundleAbort?.abort();
    });

    try {
      const installer = opts.bibleOnly ? BibleBundleInstaller : BundleInstaller;
      await installer.install({
        force: opts.force,
        version: opts.version,
        signal,
        onProgress: (p: BundleProgress) => {
          bundleProgress.value = p;
          const pct = bundlePercentOf(p);
          const received = p.bytesReceived ?? (p.phase === "download" ? p.current : 0);
          const totalBytes = p.bytesTotal ?? 0;
          const rate = p.bytesPerSecond ?? 0;
          const detail =
            p.phase === "download"
              ? totalBytes > 0
                ? `${humanSize(received)} / ${humanSize(totalBytes)} · ${humanSize(rate)}/s`
                : received > 0
                  ? `${humanSize(received)} baixados · ${humanSize(rate)}/s`
                  : p.detail || p.phase
              : p.detail || p.phase;
          const translatedDetail = formatBackgroundTaskDetail(detail, t);
          bgTasks.updateTask(taskId, {
            progress: pct,
            detail: translatedDetail || detail,
          });
        },
      });

      bgTasks.completeTask(taskId);
      bundleReady = true;
      if (!opts.bibleOnly) catalogReady = true;
      bumpBibleRevision();
      return true;
    } catch (e) {
      if (signal.aborted) {
        bgTasks.updateTask(taskId, { status: "cancelled" });
      } else {
        console.error("[useSyncManager] downloadBundle:", e);
        bgTasks.updateTask(taskId, { status: "error" });
      }
      return false;
    } finally {
      bundleInstalling.value = false;
      activeBundleAbort = null;
    }
  }

  function cancelBundle(): void {
    activeBundleAbort?.abort();
  }

  /**
   * Garante a Bíblia local quando o usuário entra numa tela bíblica. A checagem
   * é só o marcador no disco — sem requisição. O ZIP é baixado uma única vez,
   * compartilhado entre todas as instâncias do composable.
   */
  async function ensureBibleBundle(): Promise<boolean> {
    if (bundleReady) return true;
    if (bundleEnsurePromise) return bundleEnsurePromise;
    if (Date.now() - bundleFailedAt < BUNDLE_RETRY_COOLDOWN_MS) return false;

    const pending = (async (): Promise<boolean> => {
      if (await BibleBundleInstaller.isInstalled()) {
        bundleReady = true;
        return true;
      }

      const installed = await downloadBundle({ bibleOnly: true });
      if (!installed) bundleFailedAt = Date.now();
      return installed;
    })();

    bundleEnsurePromise = pending;
    try {
      return await pending;
    } finally {
      if (bundleEnsurePromise === pending) bundleEnsurePromise = null;
    }
  }

  /**
   * Garante o catálogo (álbuns, músicas, hinário…) local antes de uma leitura
   * em massa. O scan da Verificação Inicial abre o JSON de cada álbum e de cada
   * música — ~2 mil requisições por instalação se o catálogo não estiver no
   * disco. O bundle geral traz tudo (e a Bíblia junto) em um único GET.
   */
  async function ensureCatalogBundle(): Promise<boolean> {
    if (catalogReady) return true;
    if (catalogEnsurePromise) return catalogEnsurePromise;
    if (Date.now() - catalogFailedAt < BUNDLE_RETRY_COOLDOWN_MS) return false;

    const pending = (async (): Promise<boolean> => {
      if (await BundleInstaller.hasBundleMarker()) {
        catalogReady = true;
        bundleReady = true;
        return true;
      }
      const installed = await downloadBundle();
      if (!installed) catalogFailedAt = Date.now();
      return installed;
    })();

    catalogEnsurePromise = pending;
    try {
      return await pending;
    } finally {
      if (catalogEnsurePromise === pending) catalogEnsurePromise = null;
    }
  }

  /**
   * Guarda local para leituras em massa. Deliberadamente não instala nada:
   * baixar o ZIP completo exige `ensureCatalogBundle()`/`downloadBundle()` a
   * partir de uma ação explícita da interface.
   */
  async function hasCatalogForBulkRead(): Promise<boolean> {
    if (!Platform.storage?.checkLocal) return true;
    if (catalogReady) return true;
    if (!(await BundleInstaller.hasBundleMarker())) return false;
    catalogReady = true;
    bundleReady = true;
    return true;
  }

  // ─── Utilities ──────────────────────────────────────────────────

  function humanSize(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"] as const;
    let i = 0;
    let val = Number(bytes);
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i += 1;
    }
    return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
  }

  async function refreshDiskUsage(
    cachedAlbums: Set<number>,
    hymnalCached: boolean,
    hymnal1996Cached = false,
    hymnal1996Ids: number[] = []
  ): Promise<DiskUsage> {
    if (!Platform.storage?.sizeOfPaths) {
      return { bytes: 0, fileCount: 0, albumCount: 0, hymnalCached: false };
    }

    const albumCount = cachedAlbums.size;
    if (albumCount === 0 && !hymnalCached && !hymnal1996Cached) {
      return { bytes: 0, fileCount: 0, albumCount: 0, hymnalCached: false };
    }

    const remotes = new Set<string>();
    const ALBUM_BATCH = 3;
    const albumIds = [...cachedAlbums];

    for (let i = 0; i < albumIds.length; i += ALBUM_BATCH) {
      const slice = albumIds.slice(i, i + ALBUM_BATCH);
      await Promise.all(
        slice.map(async (id) => {
          const files = await collectAlbumFileList(id);
          files.forEach((f) => remotes.add(f.remote));
        })
      );
    }

    if (hymnalCached) {
      const hymFiles = await collectHymnalFileList(albumIds);
      hymFiles.forEach((f) => remotes.add(f.remote));
    }

    if (hymnal1996Cached && hymnal1996Ids.length) {
      const hymFiles = await collectHymnalFileList(hymnal1996Ids);
      hymFiles.forEach((f) => remotes.add(f.remote));
    }

    const { bytes, count } = (await Platform.storage.sizeOfPaths([
      ...remotes,
    ])) as StorageSizeResult;
    return { bytes: bytes ?? 0, fileCount: count ?? 0, albumCount, hymnalCached };
  }

  // ─── Libras Downloads ──────────────────────────────────────────

  const librasMusicCancelled = ref(false);
  const librasBibleCancelled = ref(false);
  const librasMusicProgress = ref({ done: 0, total: 0, current: "" });
  const librasBibleProgress = ref({ done: 0, total: 0, current: "" });

  let _librasMusicAbort: AbortController | null = null;
  let _librasBibleAbort: AbortController | null = null;

  async function startLibrasMusicDownloads(
    hymnalIds: number[],
    hymnal1996Ids: number[],
    selectedAlbums: Set<number>,
    region?: string
  ): Promise<number> {
    const allIds: number[] = [];

    if (hymnalIds.length) allIds.push(...hymnalIds);
    if (hymnal1996Ids.length) allIds.push(...hymnal1996Ids);

    for (const albumId of selectedAlbums) {
      const albumData = await Database.get<{ musics?: { id_music: number; name: string }[] }>(
        `album_${albumId}`
      );
      if (albumData?.musics) {
        for (const m of albumData.musics) {
          const id = Number(m.id_music);
          const cacheId = Libras.musicCacheId(id, region);
          const existing = await Libras.getCached(cacheId, "music");
          if (!existing?.bundles_cached) {
            allIds.push(id);
          }
        }
      }
    }

    if (allIds.length === 0) return 0;

    librasMusicCancelled.value = false;
    librasMusicProgress.value = { done: 0, total: allIds.length, current: "" };
    _librasMusicAbort = new AbortController();
    const signal = _librasMusicAbort.signal;

    let translated = 0;

    bgTasks.registerTask("libras-music", t("shell.background_tasks.libras_music"), () => {
      librasMusicCancelled.value = true;
      _librasMusicAbort?.abort();
    });

    for (let i = 0; i < allIds.length; i++) {
      if (librasMusicCancelled.value || signal.aborted) break;

      const id = allIds[i];
      try {
        const music = await Database.get<Music>(`music_${id}`);
        if (!music) continue;
        librasMusicProgress.value = {
          ...librasMusicProgress.value,
          current: music.name || `#${id}`,
        };
        const result = await Libras.translateMusic(
          id,
          music,
          "pt",
          (stage, done, total) => {
            const songProgress = ((i + done / total) / allIds.length) * 100;
            bgTasks.updateTask("libras-music", {
              progress: Math.round(songProgress),
              detail: `${i + 1}/${allIds.length} — ${stage === "download" ? "bundles" : "gloss"}`,
            });
          },
          region,
          signal
        );
        if (result) translated++;
        librasMusicProgress.value = { done: i + 1, total: allIds.length, current: "" };
      } catch (e) {
        if (signal.aborted) break;
        console.error(`[useSyncManager] Erro ao traduzir música ${id}:`, e);
      }
    }

    if (librasMusicCancelled.value || signal.aborted) {
      bgTasks.updateTask("libras-music", { status: "cancelled" });
    } else {
      bgTasks.completeTask("libras-music");
    }

    librasMusicCancelled.value = false;
    _librasMusicAbort = null;
    return translated;
  }

  async function startLibrasBibleDownloads(
    versionIds: number[],
    bibleVersions: BibleVersion[],
    books: BibleBook[],
    lang: string,
    region?: string
  ): Promise<number> {
    const chapters: { versionId: number; abbreviation: string; book: BibleBook; ch: number }[] = [];

    for (const versionId of versionIds) {
      const version = bibleVersions.find((v) => v.id_bible_version === versionId);
      if (!version) continue;
      for (const book of books) {
        for (let ch = 1; ch <= (book.chapters ?? 1); ch++) {
          const cacheId = Libras.bibleCacheId(version.abbreviation, book.id_bible_book, ch, region);
          const existing = await Libras.getCached(cacheId, "bible");
          if (!existing?.bundles_cached) {
            chapters.push({ versionId, abbreviation: version.abbreviation, book, ch });
          }
        }
      }
    }

    if (chapters.length === 0) return 0;

    librasBibleCancelled.value = false;
    librasBibleProgress.value = { done: 0, total: chapters.length, current: "" };
    _librasBibleAbort = new AbortController();
    const signal = _librasBibleAbort.signal;

    let translated = 0;

    bgTasks.registerTask("sync-bible-libras", t("shell.background_tasks.libras_bible"), () => {
      librasBibleCancelled.value = true;
      _librasBibleAbort?.abort();
    });

    for (let i = 0; i < chapters.length; i++) {
      if (librasBibleCancelled.value || signal.aborted) break;

      const { versionId, abbreviation, book, ch } = chapters[i];
      try {
        const verses = await Database.get<Record<string, string>>(
          `bible_${versionId}_${book.id_bible_book}_${ch}`
        );
        if (!verses) continue;
        librasBibleProgress.value = {
          ...librasBibleProgress.value,
          current: `${book.name ?? abbreviation} ${ch}`,
        };
        const result = await Libras.translateBibleChapter(
          abbreviation,
          book,
          ch,
          verses,
          lang,
          (_stage, done, total) => {
            const chProgress = ((i + done / total) / chapters.length) * 100;
            bgTasks.updateTask("sync-bible-libras", {
              progress: Math.round(chProgress),
              detail: `${i + 1}/${chapters.length} — ${book.name ?? abbreviation} ${ch}`,
            });
          },
          region,
          signal
        );
        if (result) translated++;
        librasBibleProgress.value = { done: i + 1, total: chapters.length, current: "" };
      } catch (e) {
        if (signal.aborted) break;
        console.error(`[useSyncManager] Erro ao traduzir bíblia:`, e);
      }
    }

    if (librasBibleCancelled.value || signal.aborted) {
      bgTasks.updateTask("sync-bible-libras", { status: "cancelled" });
    } else {
      bgTasks.completeTask("sync-bible-libras");
    }

    librasBibleCancelled.value = false;
    _librasBibleAbort = null;
    return translated;
  }

  function cancelLibrasDownloads(): void {
    librasMusicCancelled.value = true;
    librasBibleCancelled.value = true;
    _librasMusicAbort?.abort();
    _librasBibleAbort?.abort();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  onBeforeUnmount(cleanup);

  function cleanup(): void {
    _downloadCleanup.forEach((fn) => {
      try {
        fn();
      } catch {
        /* noop */
      }
    });
    _downloadCleanup = [];
  }

  return {
    ftpOk,
    ftpChecking,
    ftpError,
    checkFtp,
    scanning,
    scanProgress,
    runScan,
    loadCatalog,
    scanCache,
    downloading,
    downloadProgress,
    downloadFailedCount,
    downloadCompletedMsg,
    startDownloads,
    cancelDownloads,
    waitForDownloadQueue,
    startLibrasMusicDownloads,
    startLibrasBibleDownloads,
    cancelLibrasDownloads,
    librasMusicProgress,
    librasBibleProgress,
    bibleDownloading,
    bibleProgress,
    bibleCompletedMsg,
    downloadBibleVersions,
    saveBibleSelectionToDisk,
    loadBibleVersions,
    scanBibleVersionsDisk,
    collectFiles,
    collectAlbumFileList,
    collectHymnalFileList,
    collectMusicFiles,
    isFileListComplete,
    originOfFileList,
    removeFilesFromCache,
    invalidateScanCache,
    fetchJson,
    humanSize,
    refreshDiskUsage,
    bundleInstalling,
    bundleProgress,
    bundlePercent,
    bibleRevision,
    downloadBundle,
    cancelBundle,
    ensureBibleBundle,
    ensureCatalogBundle,
    cleanup,
  };
}
