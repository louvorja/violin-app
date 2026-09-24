/**
 * BundleInstaller — Baixa o bundle do banco de dados (ZIP) da API,
 * extrai os JSONs e publica o catálogo com um commit atômico no IndexedDB.
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
  /** Epoch da exportação da origem; muda mesmo quando o schema não muda. */
  source_version?: number;
  installed_at: string;
}

interface RemoteBundleConfig {
  version_number: number;
  source_version?: number;
}

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

function abortCheck(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function progressReporter(onProgress?: (p: BundleProgress) => void) {
  let lastAt = 0;
  return (progress: BundleProgress, final = false) => {
    const now = Date.now();
    if (!final && now - lastAt < 100) return;
    lastAt = now;
    onProgress?.(progress);
  };
}

function parseRemoteVersion(value: unknown): RemoteBundleConfig | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as { version?: unknown; version_number?: unknown };
  const versionNumber =
    typeof raw.version_number === "number" &&
    Number.isFinite(raw.version_number) &&
    raw.version_number >= 0
      ? raw.version_number
      : null;
  const sourceVersion =
    typeof raw.version === "number" && Number.isFinite(raw.version) && raw.version >= 0
      ? raw.version
      : null;
  if (versionNumber === null && sourceVersion === null) return null;
  return {
    version_number: versionNumber ?? sourceVersion!,
    ...(sourceVersion === null ? {} : { source_version: sourceVersion }),
  };
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
    if (!reader) {
      const buffer = await res.arrayBuffer();
      abortCheck(signal);
      return buffer;
    }

    const chunks: BlobPart[] = [];
    let receivedBytes = 0;
    const startedAt = Date.now();
    const report = progressReporter(onProgress);

    try {
      while (true) {
        abortCheck(signal);
        const { done, value } = await reader.read();
        abortCheck(signal);
        if (done) break;
        if (!value) continue;

        chunks.push(value);
        receivedBytes += value.byteLength;
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
        // Durante o download, current/total representam bytes recebidos/total.
        report({
          phase: "download",
          current: receivedBytes,
          total: totalBytes,
          bytesReceived: receivedBytes,
          bytesTotal: totalBytes,
          bytesPerSecond: receivedBytes / elapsedSeconds,
        });
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }

    report(
      {
        phase: "download",
        current: receivedBytes,
        total: totalBytes,
        bytesReceived: receivedBytes,
        bytesTotal: totalBytes,
      },
      true
    );

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
    const report = progressReporter(onProgress);
    let lastYield = Date.now();
    for (let i = 0; i < entries.length; i++) {
      abortCheck(signal);
      const key = keyFromPath(entries[i]);
      if (!key) continue;
      const raw = await zip.files[entries[i]].async("text");
      abortCheck(signal);
      if (datasets.has(key)) throw new Error(`Bundle inválido: chave duplicada ${key}`);
      datasets.set(key, JSON.parse(raw));
      report({ phase: "extract", current: i + 1, total: entries.length }, i === entries.length - 1);
      if (Date.now() - lastYield >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = Date.now();
      }
    }
    abortCheck(signal);
    return datasets;
  },

  async install(opts: {
    force?: boolean;
    version?: number;
    onProgress?: (p: BundleProgress) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const { version, onProgress, signal } = opts;
    const installStartedAt = Date.now();
    let stage: "download" | "extract" | "validate" | "resolve_version" | "inject" = "download";
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
      stage = "extract";
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
      stage = "validate";
      const config = datasets.get("config");
      if (
        datasets.size < 2 ||
        !config ||
        typeof config !== "object" ||
        Array.isArray(config)
      ) {
        throw new Error("Bundle inválido: configuração do banco ausente");
      }

      // Grava marker confirmando instalação do bundle
      // Usa a versão recebida como parâmetro (evita fetchRemoteConfig redundante)
      stage = "resolve_version";
      let markerVersion = version ?? 0;
      let sourceVersion: number | undefined = version;
      // O ZIP já traz o `config`: perguntar de novo à API seria uma segunda
      // requisição só para saber o que acabou de chegar.
      const bundled = markerVersion ? null : parseRemoteVersion(datasets.get("config"));
      if (bundled) {
        markerVersion = bundled.source_version ?? bundled.version_number;
        sourceVersion = bundled.source_version;
      } else if (!markerVersion) {
        try {
          const remote = await this.fetchRemoteConfig();
          markerVersion = remote?.source_version ?? remote?.version_number ?? 0;
          sourceVersion = remote?.source_version;
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
      const marker = {
        id: BUNDLE_MARKER_KEY,
        data: {
          id: BUNDLE_MARKER_KEY,
          version_number: markerVersion,
          ...(sourceVersion == null ? {} : { source_version: sourceVersion }),
          installed_at: new Date().toISOString(),
        } satisfies BundleMarker,
        ts: Date.now(),
        v: import.meta.env.VITE_DB_VERSION || "",
      };

      abortCheck(signal);
      stage = "inject";
      const injectStartedAt = Date.now();
      const report = progressReporter(onProgress);
      await $database.seedBundleAtomic(datasets, marker, {
        signal,
        onProgress: (current, total, key) =>
          report({ phase: "inject", current, total, detail: key }, current === total),
      });
      const injectMs = Date.now() - injectStartedAt;
      Telemetry.track("database_bundle_stage_completed", {
        stage: "inject",
        duration_ms: injectMs,
        datasets: datasets.size,
      });
      Telemetry.histogram("louvorja.database.bundle.stage.duration", injectMs, { stage: "inject" });
      $dev.write("[BundleInstaller] Bundle injetado", `${datasets.size} datasets`);
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
      if (!signal?.aborted) {
        Telemetry.captureException(error, {
          source: "database_bundle_install",
          version: version ?? null,
          stage,
        });
      }
      Telemetry.track("database_bundle_install_failed", {
        version: version ?? null,
        duration_ms: durationMs,
        reason: error instanceof Error ? error.name : "unknown",
        stage,
        aborted: signal?.aborted === true,
      });
      Telemetry.histogram("louvorja.database.bundle.install.duration", durationMs, {
        outcome: signal?.aborted ? "aborted" : "failed",
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
      return (row.data.source_version ?? row.data.version_number) === expectedVersion;
    } catch {
      return false;
    }
  },

  /**
   * True só se um bundle completo terminou de instalar neste aparelho — o
   * marcador é o último a ser gravado. Diferente de getInstalledBundleVersion,
   * não considera o dataset `config` em cache: a web o guarda rotineiramente,
   * sem nunca ter instalado bundle nenhum.
   */
  async hasBundleMarker(): Promise<boolean> {
    try {
      const row = await $idb.get<{ data?: BundleMarker }>(DB_TABLE.CACHE, BUNDLE_MARKER_KEY);
      return !!row?.data;
    } catch {
      return false;
    }
  },

  /** Retorna a versão do último bundle instalado, sem buscar na rede. */
  async getInstalledBundleVersion(): Promise<number | null> {
    try {
      const marker = await $idb.get<{
        data?: { version_number?: unknown; source_version?: unknown };
      }>(DB_TABLE.CACHE, BUNDLE_MARKER_KEY);
      const markerVersion = marker?.data?.source_version ?? marker?.data?.version_number;
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
  async fetchRemoteConfig(): Promise<RemoteBundleConfig | null> {
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

  async _fetchRemoteConfigOnce(): Promise<RemoteBundleConfig | null> {
    const fetchConfig = async (
      url: string,
      token: string,
      source: string
    ): Promise<RemoteBundleConfig | null> => {
      const res = await fetchWithTimeout(url, {
        headers: { "Api-Token": token },
        cache: "no-store",
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
