/**
 * Instala o bundle somente da Bíblia no IndexedDB.
 *
 * O bundle geral do banco continua existindo para restauração manual. A Bíblia
 * usa este arquivo menor e só o baixa quando uma tela bíblica é aberta.
 *
 * O texto bíblico não muda com as atualizações do catálogo, então a instalação
 * não acompanha a versão remota do banco: o marcador local basta, e a checagem
 * não faz nenhuma requisição.
 */
import $database from "@/helpers/Database";
import $idb from "@/helpers/IndexedDB";
import BundleInstaller from "@/helpers/BundleInstaller";
import type { BundleProgress } from "@/types/Database";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { API_TOKEN, API_URL, API_URL_FALLBACK, API_URL_FALLBACK_TOKEN } from "@/config/Api";
import { DB_TABLE } from "@/constants/DbTables";
import { extractBundleEntries } from "@/helpers/BundleExtraction";

const MARKER_KEY = "__bible_bundle_marker__";

/** Sobe quando o app precisar rebaixar a Bíblia: texto corrigido na origem ou formato novo. */
const BUNDLE_REVISION = 1;

interface BibleBundleMarker {
  id: string;
  revision: number;
  installed_at: string;
}

interface InstallOptions {
  onProgress?: (progress: BundleProgress) => void;
  signal?: AbortSignal;
}

function abortCheck(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function fetchBuffer(
  url: string,
  token: string,
  onProgress?: (progress: BundleProgress) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const response = await fetchWithTimeout(url, {
    headers: { "Api-Token": token },
    signal,
    timeout: NET_TIMEOUT.MEDIA,
    source: "bible-bundle",
  });
  if (!response.ok) throw new Error(`Bible bundle failed: HTTP ${response.status}`);

  const totalBytes = Number(response.headers.get("content-length") || 0);
  const reader = response.body?.getReader();
  if (!reader) return response.arrayBuffer();

  const chunks: BlobPart[] = [];
  let receivedBytes = 0;
  const startedAt = Date.now();
  while (true) {
    abortCheck(signal);
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.byteLength;
    const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.001);
    onProgress?.({
      phase: "download",
      current: receivedBytes,
      total: totalBytes,
      bytesReceived: receivedBytes,
      bytesTotal: totalBytes,
      bytesPerSecond: receivedBytes / elapsed,
    });
  }
  return new Blob(chunks).arrayBuffer();
}

async function fetchBibleBundle(
  onProgress?: (progress: BundleProgress) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const url = `${API_URL}/db/bible-bundle`;
  try {
    return await fetchBuffer(url, API_TOKEN, onProgress, signal);
  } catch (primaryError) {
    if (!API_URL_FALLBACK || API_URL_FALLBACK === API_URL) throw primaryError;
    return fetchBuffer(
      `${API_URL_FALLBACK}/db/bible-bundle`,
      API_URL_FALLBACK_TOKEN,
      onProgress,
      signal
    );
  }
}

export default {
  /**
   * Só olha o disco local. O banco completo (instalado no desktop antes deste
   * bundle existir) já trouxe todos os capítulos, então também vale — mas só o
   * marcador de instalação concluída, nunca o `config` em cache.
   */
  async isInstalled(): Promise<boolean> {
    try {
      const row = await $idb.get<{ data?: BibleBundleMarker }>(DB_TABLE.CACHE, MARKER_KEY);
      if (row?.data?.revision === BUNDLE_REVISION) return true;
    } catch {
      // Marcador ilegível: cai para a checagem do banco completo.
    }
    return BundleInstaller.hasBundleMarker();
  },

  async install({ onProgress, signal }: InstallOptions = {}): Promise<void> {
    abortCheck(signal);
    const buffer = await fetchBibleBundle(onProgress, signal);
    abortCheck(signal);

    // Um capítulo por vez: são ~15 mil, e segurar todos parseados em memória
    // seria um pico de centenas de MB num PC fraco. Se cair no meio, os já
    // gravados são válidos e, sem o marcador, a próxima abertura recomeça.
    let chapters = 0;
    await extractBundleEntries(buffer, {
      kind: "bible",
      signal,
      onEntry: async ({ key, data, current, total }) => {
        abortCheck(signal);
        await $database.seed(key, data);
        chapters++;
        onProgress?.({ phase: "inject", current, total, detail: key });
      },
    });
    if (chapters === 0) throw new Error("Bible bundle inválido: nenhum capítulo encontrado");
    abortCheck(signal);

    await $idb.put(DB_TABLE.CACHE, {
      id: MARKER_KEY,
      data: {
        id: MARKER_KEY,
        revision: BUNDLE_REVISION,
        installed_at: new Date().toISOString(),
      } satisfies BibleBundleMarker,
      ts: Date.now(),
      v: import.meta.env.VITE_DB_VERSION || "",
    });
  },

  markerKey: MARKER_KEY,
};
