import { useLiturgyI18n } from "../i18n";
import { buildPackage, MAX_PACKAGE_FILES, PACKAGE_EXT, safeFileName } from "../package/format";
import {
  collectFiles,
  countExport,
  type CollectDeps,
  type ExportCounts,
  type ExportOptions,
  type LocalFile,
} from "../package/collect";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { useBusy } from "@/composables/useBusy";
import { readLiturgyFile } from "@/helpers/LiturgyFiles";
import $idb from "@/helpers/IndexedDB";
import $path from "@/helpers/Path";
import Platform from "@/helpers/Platform";
import $alert, { escapeHtml } from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import { assertWebQuota, maxPackageBytes, usesLargeFileLimit } from "@/helpers/StorageLimits";
import { libraryFileInfo, openOpfsLibraryFile } from "@/helpers/LibraryFiles";
import { createExportSink } from "@/helpers/ExportSink";
import type { LiturgyItem } from "@/types/Liturgy";

type Report = (_error: unknown, _operation: string, _properties?: Record<string, unknown>) => void;

/**
 * Arquivo do disco (desktop) ou já em `louvorja://`. O stream só é aberto
 * quando a exportação chega nele — nada de carregar 5 GB na memória.
 */
async function readLocal(path: string): Promise<LocalFile | null> {
  if (!path) return null;
  const opfs = await openOpfsLibraryFile(path);
  if (opfs) return opfs;
  if (!Platform.isDesktop) return null;
  const url = $path.media(path);
  const response = await fetchWithTimeout(url, { timeout: NET_TIMEOUT.MEDIA, source: "file" });
  if (!response.ok || !response.body) return null;
  let size = Number(response.headers.get("content-length")) || 0;
  if (!size) {
    // Caminho do acervo: o helper sabe o tamanho sem abrir o arquivo.
    const info = await libraryFileInfo(path).catch(() => null);
    size = info?.size || 0;
  }
  return {
    size,
    open: async () => response.body as ReadableStream<Uint8Array>,
  };
}

const collectDeps: CollectDeps = {
  get: (table, id) => $idb.get(table, id),
  readLiturgyFile,
  readLocal,
};

/** Quantos arquivos cada opção da janela de exportação leva. */
export function countExportFiles(items: LiturgyItem[]): ExportCounts {
  return countExport(items);
}

/** Até três nomes, e "+N" — a lista inteira não cabe num aviso. Já escapado. */
function shortList(names: string[]): string {
  const shown = names.slice(0, 3).map((n) => `• ${escapeHtml(n)}`);
  if (names.length > 3) shown.push(`… +${names.length - 3}`);
  return shown.join("<br>");
}

/**
 * Exportar a liturgia que está na tela como pacote `.llja`, com os arquivos
 * que ela usa (conforme as opções escolhidas na janela de exportação).
 */
export function useLiturgyExport(report: Report) {
  const { t } = useLiturgyI18n();
  const { busy, run } = useBusy();

  async function exportLiturgy(
    input: { name: string; color?: string; items: LiturgyItem[] },
    options: ExportOptions
  ): Promise<void> {
    if (busy.value) return;
    if (!input.items.length) {
      $snackbar.warning(t("library.export_empty"));
      Telemetry.track("liturgy_operation_blocked", { operation: "export", reason: "empty" });
      return;
    }
    const result = await run(async () => {
      try {
        const collected = await collectFiles(input.items, options, collectDeps);
        if (collected.files.length > MAX_PACKAGE_FILES) return { tooMany: true as const };
        const size = collected.files.reduce((total, f) => total + f.size, 0);
        if (size > maxPackageBytes()) return { tooLarge: true as const };
        if (!Platform.isDesktop) await assertWebQuota(size);
        const fileName = `${safeFileName(input.name, "Liturgia")}.${PACKAGE_EXT}`;
        const sink = await createExportSink(fileName);
        if (!sink) return { canceled: true as const };
        try {
          const built = await buildPackage({
            liturgy: input,
            files: collected.files,
            appVersion: import.meta.env.VITE_APP_VERSION || "",
            sink: sink.stream,
          });
          await sink.commit();
          return { ...collected, ...built, fileName };
        } catch (error) {
          await sink.abort().catch(() => {});
          throw error;
        }
      } catch (error) {
        report(error, "export", { format: PACKAGE_EXT });
        console.error("[Liturgia] export falhou:", error);
        return null;
      }
    });
    if (!result) {
      $snackbar.error(t("library.export_error"));
      return;
    }
    if ("canceled" in result) return;
    if ("tooMany" in result) {
      $alert.error({ text: escapeHtml(t("library.export_too_many_files")), translate: false });
      Telemetry.track("liturgy_operation_blocked", {
        operation: "export",
        reason: "too_many_files",
      });
      return;
    }
    if ("tooLarge" in result) {
      $alert.error({
        text: escapeHtml(
          t(
            usesLargeFileLimit()
              ? "library.export_too_large_desktop"
              : "library.export_too_large_web"
          )
        ),
        translate: false,
      });
      Telemetry.track("liturgy_operation_blocked", { operation: "export", reason: "too_large" });
      return;
    }
    Telemetry.track("liturgy_export_completed", {
      format: PACKAGE_EXT,
      item_count: input.items.length,
      file_count: result.files.length,
      missing_files: result.missing.length,
      local_only: result.localOnly.length,
      with_media: options.media,
      with_background_sound: options.backgroundSound,
      with_background_projection: options.backgroundProjection,
    });

    const warnings: string[] = [];
    if (result.missing.length)
      warnings.push(`${escapeHtml(t("library.export_missing"))}<br>${shortList(result.missing)}`);
    if (result.localOnly.length)
      warnings.push(
        `${escapeHtml(t("library.export_local_only"))}<br>${shortList(result.localOnly)}`
      );
    if (warnings.length) {
      $alert.info({
        // Texto com nomes do operador: sem passar pelo $t do diálogo.
        title: escapeHtml(t("library.export_title")),
        text: warnings.join("<br><br>"),
        translate: false,
      });
    } else {
      $snackbar.success(t("library.export_success"));
    }
  }

  return { busy, exportLiturgy };
}
