/**
 * WebFileStore.ts — Mesmo contrato de `Platform.download` e `Platform.storage`
 * do desktop, para o web/PWA.
 *
 * No Electron o main process baixa os arquivos para a pasta de dados; aqui eles
 * vão para o Cache Storage, nos mesmos caches que o service worker consulta
 * (`louvorja-audio` e `louvorja-images`, ver `vite.config.js`). Como a URL
 * pedida pelo player é a mesma que foi gravada, tocar offline não exige mudança
 * em nenhum consumidor. Com isso `useSyncManager` e a tela Sincronizar servem
 * às duas plataformas com a mesma lógica.
 *
 * @category helper-puro — Sem APIs Vue; usa Cache Storage e fetch.
 */
import { createAdaptiveConcurrency } from "@root/electron/main/download/adaptiveConcurrency.mjs";
import { API_URL } from "@/config/Api";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { resolveMediaReference } from "@/helpers/MediaUrl";

export const AUDIO_CACHE = "louvorja-audio";
export const IMAGE_CACHE = "louvorja-images";

// Mantenha igual ao padrão de áudio do runtimeCaching em vite.config.js.
const AUDIO_RE = /\.(mp3|ogg|opus|m4a|aac|wav|flac)(\?.*)?$/i;

/** Ponto de partida e teto de downloads simultâneos, conforme o que o aparelho declara. */
export function webConcurrencyBounds(nav: Navigator | undefined = globalThis.navigator): {
  start: number;
  max: number;
} {
  const conn = (
    nav as (Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }) | undefined
  )?.connection;
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  const cores = nav?.hardwareConcurrency ?? 4;
  if (conn?.saveData || /^(slow-)?2g$/.test(conn?.effectiveType ?? "")) return { start: 2, max: 2 };
  if (conn?.effectiveType === "3g") return { start: 2, max: 3 };
  const weak = (memory !== undefined && memory <= 2) || cores <= 2;
  return weak ? { start: 3, max: 4 } : { start: 4, max: 8 };
}

export interface WebFileEntry {
  remote: string;
  remoteUrl?: string;
}

type Listener<T> = (data: T) => void;
type Emitter<T> = { on(cb: Listener<T>): () => void; emit(data: T): void };

function emitter<T>(): Emitter<T> {
  const listeners = new Set<Listener<T>>();
  return {
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(data) {
      for (const cb of [...listeners]) {
        try {
          cb(data);
        } catch (e) {
          console.warn("[WebFileStore] listener falhou:", e);
        }
      }
    },
  };
}

export function isWebFileStoreSupported(): boolean {
  return typeof caches !== "undefined" && typeof window !== "undefined";
}

function cacheNameFor(url: string): string {
  return AUDIO_RE.test(url) ? AUDIO_CACHE : IMAGE_CACHE;
}

function urlFor(remote: string): string | null {
  return resolveMediaReference(remote)?.url ?? null;
}

async function openCaches(): Promise<Record<string, Cache>> {
  const [audio, images] = await Promise.all([caches.open(AUDIO_CACHE), caches.open(IMAGE_CACHE)]);
  return { [AUDIO_CACHE]: audio, [IMAGE_CACHE]: images };
}

async function isCached(url: string, store: Record<string, Cache>): Promise<boolean> {
  return Boolean(await store[cacheNameFor(url)].match(url, { ignoreVary: true }));
}

const onProgress = emitter<{ file: string; total?: number }>();
const onFileDone = emitter<{ file: string }>();
const onFileError = emitter<{ file: string; error: string }>();
const onQueueDone = emitter<{ downloaded: number; failed: number }>();
const onQueueCancelled = emitter<Record<string, never>>();

let controller: AbortController | null = null;

async function downloadOne(
  remote: string,
  url: string,
  store: Record<string, Cache>,
  signal: AbortSignal
): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        timeout: NET_TIMEOUT.MEDIA,
        source: "web-download",
        signal,
      });
      // Só 200 inteiro: um 206 gravado como arquivo completo tocaria cortado.
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const bytes = Number(response.headers.get("content-length")) || 0;
      await store[cacheNameFor(url)].put(url, response);
      return bytes;
    } catch (e) {
      lastError = e;
      if (signal.aborted) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Falha ao baixar ${remote}`);
}

async function runQueue(
  pending: Array<{ remote: string; url: string }>,
  store: Record<string, Cache>,
  signal: AbortSignal
): Promise<void> {
  let next = 0;
  let downloaded = 0;
  let failed = 0;
  const { start, max } = webConcurrencyBounds();
  const adaptive = createAdaptiveConcurrency({ min: 2, start, max });
  // Todos os workers existem; só os de índice abaixo do limite atual pegam
  // trabalho, os demais esperam o limite subir.
  const worker = async (index: number): Promise<void> => {
    while (next < pending.length && !signal.aborted) {
      if (index >= adaptive.limit()) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const { remote, url } = pending[next++];
      onProgress.emit({ file: remote, total: pending.length });
      try {
        const bytes = await downloadOne(remote, url, store, signal);
        adaptive.report({ bytes, ok: true });
        downloaded++;
        onFileDone.emit({ file: remote });
      } catch (e) {
        if (signal.aborted) return;
        adaptive.report({ ok: false });
        failed++;
        console.warn("[WebFileStore] falhou:", remote, e);
        onFileError.emit({ file: remote, error: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, pending.length) }, (_, i) => worker(i)));
  if (signal.aborted) onQueueCancelled.emit({});
  else onQueueDone.emit({ downloaded, failed });
}

export const webDownload = {
  async setApiConfig(): Promise<{ ok: true }> {
    return { ok: true };
  },
  async getParams(): Promise<null> {
    return null;
  },
  async checkConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await fetchWithTimeout(API_URL, {
        method: "HEAD",
        timeout: NET_TIMEOUT.QUICK,
        source: "probe",
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
  async isDownloading(): Promise<boolean> {
    return controller !== null;
  },

  /** Enfileira o que ainda não está guardado; resolve assim que a fila começa, como no desktop. */
  async start(files: WebFileEntry[]): Promise<{ queued: number; message?: string }> {
    if (controller) controller.abort();
    const store = await openCaches();
    const pending: Array<{ remote: string; url: string }> = [];
    for (const f of files) {
      const url = f.remoteUrl || urlFor(f.remote);
      if (!url || (await isCached(url, store))) continue;
      pending.push({ remote: f.remote, url });
    }
    if (pending.length === 0) return { queued: 0 };

    // Evita que o navegador apague o acervo sozinho quando faltar espaço.
    await requestPersistence();

    const mine = new AbortController();
    controller = mine;
    void runQueue(pending, store, mine.signal).finally(() => {
      if (controller === mine) controller = null;
    });
    return { queued: pending.length };
  },
  async cancel(): Promise<void> {
    controller?.abort();
  },

  onProgress: (cb: Listener<{ file: string; total?: number }>) => onProgress.on(cb),
  onFileDone: (cb: Listener<{ file: string }>) => onFileDone.on(cb),
  onFileError: (cb: Listener<{ file: string; error: string }>) => onFileError.on(cb),
  onQueueDone: (cb: Listener<{ downloaded: number; failed: number }>) => onQueueDone.on(cb),
  onQueueCancelled: (cb: Listener<Record<string, never>>) => onQueueCancelled.on(cb),
};

/**
 * Pede ao navegador que não apague os dados do app sozinho quando faltar
 * espaço. O Chrome decide por conta própria (costuma conceder a PWA instalado),
 * então o resultado é informativo: sem persistência tudo funciona do mesmo jeito.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export interface WebStorageUsage {
  /** Bytes usados por tudo que o app guarda neste navegador. */
  usage: number;
  /** Teto que o navegador reserva para o app (depende do disco livre). */
  quota: number;
  /** O navegador prometeu não apagar os dados sozinho. */
  persisted: boolean;
}

export async function webStorageUsage(): Promise<WebStorageUsage> {
  const estimate = (await navigator.storage?.estimate?.().catch(() => null)) ?? {};
  const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
}

export const webStorage = {
  /** "own" quando o arquivo está guardado neste aparelho; no web não existe acervo clássico. */
  async checkLocal(remotes: string[]): Promise<Record<string, "own" | false>> {
    const store = await openCaches();
    const entries = await Promise.all(
      remotes.map(async (remote) => {
        const url = urlFor(remote);
        return [remote, url && (await isCached(url, store)) ? ("own" as const) : false] as const;
      })
    );
    return Object.fromEntries(entries);
  },

  async removeFiles(remotes: string[]): Promise<void> {
    const store = await openCaches();
    await Promise.all(
      remotes.map(async (remote) => {
        const url = urlFor(remote);
        if (url) await store[cacheNameFor(url)].delete(url, { ignoreVary: true });
      })
    );
  },

  /** Apaga todo o áudio e as imagens baixados; o catálogo (IndexedDB) fica. */
  async clearFiles(): Promise<void> {
    await Promise.all([AUDIO_CACHE, IMAGE_CACHE].map((name) => caches.delete(name)));
  },

  async sizeOfPaths(remotes: string[]): Promise<{ bytes: number; count: number }> {
    const store = await openCaches();
    let bytes = 0;
    let count = 0;
    for (const remote of remotes) {
      const url = urlFor(remote);
      const hit = url ? await store[cacheNameFor(url)].match(url, { ignoreVary: true }) : null;
      if (!hit) continue;
      count++;
      const declared = Number(hit.headers.get("content-length"));
      bytes +=
        Number.isFinite(declared) && declared > 0 ? declared : (await hit.clone().blob()).size;
    }
    return { bytes, count };
  },
};
