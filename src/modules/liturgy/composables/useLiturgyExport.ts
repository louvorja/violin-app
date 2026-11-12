import { useLiturgyI18n } from "../i18n";
import { buildPackage, MAX_PACKAGE_BYTES, PACKAGE_EXT, safeFileName } from "../package/format";
import {
  collectFiles,
  countExport,
  type CollectDeps,
  type ExportCounts,
  type ExportOptions,
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
import type { LiturgyItem } from "@/types/Liturgy";

type Report = (_error: unknown, _operation: string, _properties?: Record<string, unknown>) => void;

/** Arquivo do disco (desktop) ou já em `louvorja://`. No navegador não há disco. */
async function readLocal(path: string): Promise<Blob | null> {
  if (!path) return null;
  const isAppUrl = /^louvorja:\/\//i.test(path);
  if (!isAppUrl && !Platform.isDesktop) return null;
  const url = isAppUrl ? path : $path.local(path);
  const response = await fetchWithTimeout(url, { timeout: NET_TIMEOUT.MEDIA, source: "file" });
  return response.ok ? response.blob() : null;
}

const collectDeps: CollectDeps = {
  get: (table, id) => $idb.get(table, id),
  getAll: (table) => $idb.getAll(table),
  readLiturgyFile,
  readLocal,
};

/** Quantos arquivos cada opção da janela de exportação leva. */
export function countExportFiles(items: LiturgyItem[]): Promise<ExportCounts> {
  return countExport(items, collectDeps.getAll);
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.click();
  // Revogar no mesmo passo do clique cancela o download em alguns Chromium.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
        const size = collected.files.reduce((total, f) => total + f.data.size, 0);
        if (size > MAX_PACKAGE_BYTES) return { tooLarge: true as const };
        const blob = await buildPackage({
          liturgy: input,
          files: collected.files,
          appVersion: import.meta.env.VITE_APP_VERSION || "",
        });
        return { blob, ...collected };
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
    if ("tooLarge" in result) {
      $alert.error({ text: escapeHtml(t("library.export_too_large")), translate: false });
      Telemetry.track("liturgy_operation_blocked", { operation: "export", reason: "too_large" });
      return;
    }
    download(result.blob, `${safeFileName(input.name, "Liturgia")}.${PACKAGE_EXT}`);
    Telemetry.track("liturgy_export_completed", {
      format: PACKAGE_EXT,
      item_count: input.items.length,
      file_count: result.files.length,
      missing_files: result.missing.length,
      local_only: result.localOnly.length,
      with_media: options.media,
      with_background_sound: options.backgroundSound,
      with_background_projection: options.backgroundProjection,
      with_background_projection_all: options.backgroundProjectionAll,
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
