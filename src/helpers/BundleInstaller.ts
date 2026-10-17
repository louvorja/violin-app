/**
 * BundleInstaller — Baixa o bundle do banco de dados (ZIP) da API,
 * extrai os JSONs e publica o catálogo com um commit atômico no IndexedDB.
 *
 * @category helper-puro — sem APIs Vue.
 */
import $database from "@/helpers/Database";
import $idb from "@/helpers/IndexedDB";
import $dev from "@/helpers/Dev";
import { DB_TABLE } from "@/constants/DbTables";
import type { BundleProgress } from "@/types/Database";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Telemetry from "@/helpers/Telemetry";
import { failureDetails, reportReliabilityFailure } from "@/helpers/ReliabilityDiagnostics";
import { extractBundleEntries } from "@/helpers/BundleExtraction";
import {
  API_URL,
  API_TOKEN,
  apiTokenHeaders,
  API_URL_FALLBACK,
  API_URL_FALLBACK_TOKEN,
  API_URL_DB,
  API_URL_DB_FALLBACK,
} from "@/config/Api";

import { BUNDLE_VALIDATION_REVISION, type BundleKind } from "@/types/Bundle";

import packageJson from "@root/package.json";

const BUNDLE_MARKER_KEY = "__bundle_marker__";

interface BundleMarker {
  id: string;
  kind: "full" | "catalog";
  validation_revision: number;
  includes_bible?: boolean;
  version_number: number;
  /** Epoch da exportação da origem; muda mesmo quando o schema não muda. */
  source_version?: number;
  /** Versão do app que instalou o catálogo: outra versão pede catálogo renovado. */
  app_version?: string;
  installed_at: string;
}

interface RemoteBundleConfig {
  version_number: number;
  source_version?: number;
}

function bundleUrl(api: string, kind: BundleKind): string {
  return `${api}/db/${kind === "catalog" ? "catalog-bundle" : "bundle"}`;
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
    signal?: AbortSignal,
    kind: "full" | "catalog" = "full"
  ): Promise<ArrayBuffer> {
    abortCheck(signal);
    const fetchFrom = (api: string, token: string) =>
      fetchWithTimeout(bundleUrl(api, kind), {
        headers: apiTokenHeaders(token),
        signal,
        cache: "no-store",
        timeout: NET_TIMEOUT.MEDIA,
        source: "bundle",
      });
    let res: Response;
    try {
      res = await fetchFrom(API_URL, API_TOKEN);
      if (!res.ok) throw new Error(`Bundle download failed: HTTP ${res.status}`);
    } catch (error) {
      abortCheck(signal);
      if (!API_URL_FALLBACK || API_URL_FALLBACK === API_URL) throw error;
      res = await fetchFrom(API_URL_FALLBACK, API_URL_FALLBACK_TOKEN);
      if (!res.ok) throw new Error(`Bundle download failed: HTTP ${res.status}`);
    }

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
    signal?: AbortSignal,
    kind: "full" | "catalog" = "full"
  ): Promise<Map<string, unknown>> {
    abortCheck(signal);
    const datasets = new Map<string, unknown>();
    const report = progressReporter(onProgress);
    await extractBundleEntries(buffer, {
      kind,
      signal,
      onEntry: ({ key, data, current, total }) => {
        if (datasets.has(key)) throw new Error(`Bundle inválido: chave duplicada ${key}`);
        datasets.set(key, data);
        report({ phase: "extract", current, total }, current === total);
      },
    });
    abortCheck(signal);
    return datasets;
  },

  async install(opts: {
    force?: boolean;
    catalogOnly?: boolean;
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
      const kind = opts.catalogOnly ? "catalog" : "full";
      const buffer = await this.fetchBundle(onProgress, signal, kind);
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
      const datasets = await this.extractBundle(buffer, onProgress, signal, kind);
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
      if (datasets.size < 2 || !config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("Bundle inválido: configuração do banco ausente");
      }

      // Grava marker confirmando instalação do bundle
      // Usa a versão recebida como parâmetro (evita fetchRemoteConfig redundante)
      stage = "resolve_version";
      const bundled = parseRemoteVersion(datasets.get("config"));
      if (!bundled) throw new Error("Bundle inválido: versão ausente");
      const markerVersion = bundled.source_version ?? bundled.version_number;
      if (
        version !== undefined &&
        version !== markerVersion &&
        version !== bundled.version_number
      ) {
        throw new Error("Bundle inválido: versão diferente da solicitada");
      }
      const sourceVersion = bundled.source_version;
      const marker = {
        id: BUNDLE_MARKER_KEY,
        data: {
          id: BUNDLE_MARKER_KEY,
          kind,
          includes_bible: kind === "full" || (await this.hasBundleMarker("full")),
          validation_revision: BUNDLE_VALIDATION_REVISION,
          version_number: markerVersion,
          ...(sourceVersion == null ? {} : { source_version: sourceVersion }),
          app_version: packageJson.version,
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
        ...failureDetails(error),
        bundle_kind: opts.catalogOnly ? "catalog" : "full",
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
  async hasBundleMarker(kind: "catalog" | "full" = "catalog"): Promise<boolean> {
    try {
      const row = await $idb.get<{ data?: BundleMarker }>(DB_TABLE.CACHE, BUNDLE_MARKER_KEY);
      return (
        row?.data?.validation_revision === BUNDLE_VALIDATION_REVISION &&
        (row.data.kind === "full" ||
          (row.data.kind === "catalog" && (kind === "catalog" || row.data.includes_bible === true)))
      );
    } catch {
      return false;
    }
  },

  /**
   * True quando há catálogo instalado, mas por outra versão do app. Cada versão
   * renova o catálogo: o servidor pode ter mudado o que entrega (endereços de
   * mídia, campos), e o que ficou guardado ainda reflete a versão anterior.
   * Sem catálogo válido devolve false: quem instala é o fluxo normal.
   */
  async catalogNeedsRefreshForApp(): Promise<boolean> {
    try {
      const row = await $idb.get<{ data?: BundleMarker }>(DB_TABLE.CACHE, BUNDLE_MARKER_KEY);
      const marker = row?.data;
      if (!marker) return false;
      if (marker.validation_revision !== BUNDLE_VALIDATION_REVISION) return true;
      return marker.app_version !== packageJson.version;
    } catch {
      return false;
    }
  },

  /** Retorna a versão do último bundle instalado, sem buscar na rede. */
  async getInstalledBundleVersion({ allowLegacyConfig = true } = {}): Promise<number | null> {
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

      if (!allowLegacyConfig) return null;
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
        headers: apiTokenHeaders(token),
        cache: "no-store",
        source,
      });
      if (!res.ok) throw new Error(`Configuração do banco: HTTP ${res.status}`);
      const config = parseRemoteVersion(await res.json());
      if (!config) throw new Error("Configuração do banco sem versão válida");
      return config;
    };

    try {
      const primary = await fetchConfig(`${API_URL_DB}/config`, API_TOKEN, "bundle-config");
      if (primary) return primary;
    } catch (error) {
      if (!API_URL_FALLBACK)
        reportReliabilityFailure("database_update_check_failed", error, {
          stage: "config",
          endpoint: "primary",
        });
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
    } catch (error) {
      reportReliabilityFailure("database_update_check_failed", error, {
        stage: "config",
        endpoint: "fallback",
      });
      return null;
    }
  },
};
