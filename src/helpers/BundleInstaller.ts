/**
 * BundleInstaller — Baixa o bundle do banco de dados (ZIP) da API,
 * extrai os JSONs e injeta no IndexedDB via roteamento do Database.
 *
 * @category helper-puro — sem APIs Vue.
 */
import JSZip from "jszip";
import $database from "@/helpers/Database";
import $idb from "@/helpers/IndexedDB";
import $dev from "@/helpers/Dev";
import { DB_TABLE } from "@/constants/DbTables";
import type { BundleProgress } from "@/types/Database";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Telemetry from "@/helpers/Telemetry";
import {
  API_URL,
  API_TOKEN,
  API_URL_FALLBACK,
  API_URL_FALLBACK_TOKEN,
  API_URL_DB,
  API_URL_DB_FALLBACK,
} from "@/config/Api";

const BUNDLE_MARKER_KEY = "__bundle_marker__";

interface BundleMarker {
  id: string;
  version_number: number;
  installed_at: string;
}

/** Tabelas limpas antes da injeção do bundle (somente dados de catálogo/banco). */
const BUNDLE_TABLES = [
  DB_TABLE.CACHE,
  DB_TABLE.MUSICS,
  DB_TABLE.HYMNAL,
  DB_TABLE.HYMNAL_1996,
  DB_TABLE.ALBUMS,
  DB_TABLE.MUSIC_CATEGORIES,
  DB_TABLE.DOXOLOGY_ALBUMS,
  DB_TABLE.CHILDREN_ALBUMS,
  DB_TABLE.ONLINE_VIDEOS,
  DB_TABLE.ONLINE_VIDEOS_CHANNELS,
  DB_TABLE.ONLINE_VIDEOS_PLAYLISTS,
  DB_TABLE.BIBLE_VERSIONS,
  DB_TABLE.BIBLE_BOOKS,
  DB_TABLE.BIBLE_CHAPTERS,
];

function bundleUrl(): string {
  return `${API_URL}/db/bundle`;
}

function authHeaders(): Record<string, string> {
  return { "Api-Token": API_TOKEN };
}

/** Converte caminho do ZIP para chave lógica do banco. */
function keyFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  if (!fileName.endsWith(".json")) return "";
  const base = fileName.replace(/\.json$/, "");

  if (parts.includes("lang")) {
    const langIdx = parts.indexOf("lang");
    return parts[langIdx + 1] ? `${parts[langIdx + 1]}_${base}` : base;
  }
  return base;
}

async function clearBundleTables(): Promise<void> {
  for (const table of BUNDLE_TABLES) {
    await $idb.clear(table);
  }
}

function abortCheck(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function parseRemoteVersion(value: unknown): { version_number: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const version = (value as { version_number?: unknown }).version_number;
  return typeof version === "number" && Number.isFinite(version) && version >= 0
    ? { version_number: version }
    : null;
}

export default {
  async fetchBundle(
    onProgress?: (p: BundleProgress) => void,
    signal?: AbortSignal
  ): Promise<ArrayBuffer> {
    abortCheck(signal);
    const res = await fetchWithTimeout(bundleUrl(), {
      headers: authHeaders(),
      signal,
      timeout: NET_TIMEOUT.MEDIA,
      source: "bundle",
    });
    if (!res.ok) throw new Error(`Bundle download failed: HTTP ${res.status}`);

    const totalBytes = Number(res.headers.get("content-length") || 0);
    const reader = res.body?.getReader();
    if (!reader) return res.arrayBuffer();

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
      const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
      const bytesPerSecond = receivedBytes / elapsedSeconds;

      // Durante o download, current/total representam bytes recebidos/total.
      onProgress?.({
        phase: "download",
        current: receivedBytes,
        total: totalBytes,
        bytesReceived: receivedBytes,
        bytesTotal: totalBytes,
        bytesPerSecond,
      });
    }

    const blob = new Blob(chunks);
    return await blob.arrayBuffer();
  },

  async extractBundle(
    buffer: ArrayBuffer,
    onProgress?: (p: BundleProgress) => void,
    signal?: AbortSignal
  ): Promise<Map<string, unknown>> {
    abortCheck(signal);
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files).filter(
      (f) => !zip.files[f].dir && f.endsWith(".json") && !f.endsWith("_manifest.json")
    );

    const datasets = new Map<string, unknown>();
    for (let i = 0; i < entries.length; i++) {
      abortCheck(signal);
      const key = keyFromPath(entries[i]);
      if (!key) continue;
      const raw = await zip.files[entries[i]].async("text");
      datasets.set(key, JSON.parse(raw));
      onProgress?.({ phase: "extract", current: i + 1, total: entries.length });
    }
    return datasets;
  },

  async injectBundle(
    datasets: Map<string, unknown>,
    onProgress?: (p: BundleProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const keys = [...datasets.keys()];
    for (let i = 0; i < keys.length; i++) {
      abortCheck(signal);
      const key = keys[i];
      await $database.seed(key, datasets.get(key));
      onProgress?.({ phase: "inject", current: i + 1, total: keys.length, detail: key });
    }
  },

  async install(opts: {
    force?: boolean;
    version?: number;
    onProgress?: (p: BundleProgress) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const { version, onProgress, signal } = opts;
    const installStartedAt = Date.now();
    Telemetry.track("database_bundle_install_started", {
      version: version ?? null,
      force: opts.force === true,
    });

    try {
      abortCheck(signal);
      onProgress?.({ phase: "download", current: 0, total: 1 });
      const downloadStartedAt = Date.now();
      const buffer = await this.fetchBundle(onProgress, signal);
      const downloadMs = Date.now() - downloadStartedAt;
      Telemetry.track("database_bundle_stage_completed", {
        stage: "download",
        duration_ms: downloadMs,
        bytes: buffer.byteLength,
      });
      Telemetry.histogram("louvorja.database.bundle.stage.duration", downloadMs, {
        stage: "download",
      });

      abortCheck(signal);
      const extractStartedAt = Date.now();
      const datasets = await this.extractBundle(buffer, onProgress, signal);
      const extractMs = Date.now() - extractStartedAt;
      Telemetry.track("database_bundle_stage_completed", {
        stage: "extract",
        duration_ms: extractMs,
        datasets: datasets.size,
      });
      Telemetry.histogram("louvorja.database.bundle.stage.duration", extractMs, {
        stage: "extract",
      });

      // Um ZIP vazio, HTML de portal cativo ou resposta de outro endpoint não
      // pode limpar o catálogo já instalado. Valide a estrutura mínima antes de
      // tocar no IndexedDB.
      if (datasets.size === 0 || !datasets.has("config")) {
        throw new Error("Bundle inválido: configuração do banco ausente");
      }

      abortCheck(signal);
      await clearBundleTables();
      $dev.write("[BundleInstaller] Tabelas limpas");

      abortCheck(signal);
      const injectStartedAt = Date.now();
      await this.injectBundle(datasets, onProgress, signal);
      const injectMs = Date.now() - injectStartedAt;
      Telemetry.track("database_bundle_stage_completed", {
        stage: "inject",
        duration_ms: injectMs,
        datasets: datasets.size,
      });
      Telemetry.histogram("louvorja.database.bundle.stage.duration", injectMs, { stage: "inject" });
      $dev.write("[BundleInstaller] Bundle injetado", `${datasets.size} datasets`);

      // Grava marker confirmando instalação do bundle
      // Usa a versão recebida como parâmetro (evita fetchRemoteConfig redundante)
      let markerVersion = version ?? 0;
      if (!markerVersion) {
        try {
          const remote = await this.fetchRemoteConfig();
          markerVersion = remote?.version_number ?? 0;
        } catch {
          // Se fetchRemoteConfig falhar, tenta ler do config local
          try {
            const localConfig = await $database.get<{ version_number?: number }>("config", {
              silent: true,
            });
            markerVersion = localConfig?.version_number ?? 0;
          } catch {
            // mantém 0
          }
        }
      }
      await $idb.put(DB_TABLE.CACHE, {
        id: BUNDLE_MARKER_KEY,
        data: {
          id: BUNDLE_MARKER_KEY,
          version_number: markerVersion,
          installed_at: new Date().toISOString(),
        } satisfies BundleMarker,
        ts: Date.now(),
        v: import.meta.env.VITE_DB_VERSION || "",
      });
      const totalMs = Date.now() - installStartedAt;
      Telemetry.track("database_bundle_install_completed", {
        version: markerVersion,
        datasets: datasets.size,
        duration_ms: totalMs,
      });
      Telemetry.histogram("louvorja.database.bundle.install.duration", totalMs, {
        outcome: "completed",
      });
      $dev.write("[BundleInstaller] Marker gravado", `v${markerVersion}`);
    } catch (error) {
      const durationMs = Date.now() - installStartedAt;
      Telemetry.captureException(error, {
        source: "database_bundle_install",
        version: version ?? null,
      });
      Telemetry.track("database_bundle_install_failed", {
        version: version ?? null,
        duration_ms: durationMs,
        reason: error instanceof Error ? error.name : "unknown",
      });
      Telemetry.histogram("louvorja.database.bundle.install.duration", durationMs, {
        outcome: "failed",
      });
      throw error;
    }
  },

  /** Verifica se o bundle da versão informada já foi instalado. */
  async isBundleInstalled(expectedVersion: number): Promise<boolean> {
    try {
      const row = await $idb.get<{ id: string; data: BundleMarker }>(
        DB_TABLE.CACHE,
        BUNDLE_MARKER_KEY
      );
      if (!row?.data) return false;
      return row.data.version_number === expectedVersion;
    } catch {
      return false;
    }
  },

  /** Retorna a versão do último bundle instalado, sem buscar na rede. */
  async getInstalledBundleVersion(): Promise<number | null> {
    try {
      const marker = await $idb.get<{ data?: { version_number?: unknown } }>(
        DB_TABLE.CACHE,
        BUNDLE_MARKER_KEY
      );
      const markerVersion = marker?.data?.version_number;
      if (
        typeof markerVersion === "number" &&
        Number.isFinite(markerVersion) &&
        markerVersion >= 0
      ) {
        return markerVersion;
      }

      // Instalações anteriores ao marker ainda têm o dataset `config` no
      // cache normalizado/legado. Ler diretamente o IDB evita disparar uma
      // requisição durante a decisão de boot offline.
      const config = await $idb.get<{ data?: { version_number?: unknown } }>(
        DB_TABLE.CACHE,
        "config"
      );
      const configVersion = config?.data?.version_number;
      return typeof configVersion === "number" &&
        Number.isFinite(configVersion) &&
        configVersion >= 0
        ? configVersion
        : null;
    } catch {
      return null;
    }
  },

  /**
   * Verifica se o bundle remoto tem versão diferente da local.
   * Retorna null se não conseguir acessar a API.
   */
  async fetchRemoteConfig(): Promise<{ version_number: number } | null> {
    // Wi-Fi de igreja soluça por meio segundo o tempo todo (ver
    // useConnectivity.ts) — sem retry, essa checagem roda no boot e um
    // soluço passageiro fazia o app achar que precisa rebaixar tudo (ou
    // não achar uma atualização real), mesmo com a API saudável segundos
    // depois.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await this._fetchRemoteConfigOnce();
      if (result !== null) return result;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  },

  async _fetchRemoteConfigOnce(): Promise<{ version_number: number } | null> {
    const fetchConfig = async (
      url: string,
      token: string,
      source: string
    ): Promise<{ version_number: number } | null> => {
      const res = await fetchWithTimeout(url, {
        headers: { "Api-Token": token },
        source,
      });
      if (!res.ok) return null;
      return parseRemoteVersion(await res.json());
    };

    try {
      const primary = await fetchConfig(`${API_URL_DB}/config`, API_TOKEN, "bundle-config");
      if (primary) return primary;
    } catch {
      // Abaixo o fallback também é tentado quando a conexão lança (timeout,
      // DNS), não apenas quando a API respondeu com HTTP ruim.
    }

    if (!API_URL_FALLBACK) return null;
    try {
      return await fetchConfig(
        `${API_URL_DB_FALLBACK}/config`,
        API_URL_FALLBACK_TOKEN,
        "bundle-config-fallback"
      );
    } catch {
      return null;
    }
  },
};
