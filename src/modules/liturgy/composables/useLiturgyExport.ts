import { useLiturgyI18n } from "../i18n";
import { buildLlja, safeFileName, LLJA_EXT, type PackedFile } from "../package";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { useBusy } from "@/composables/useBusy";
import { readLiturgyFile } from "@/helpers/LiturgyFiles";
import $path from "@/helpers/Path";
import Platform from "@/helpers/Platform";
import $alert from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import type { LiturgyItem } from "@/types/Liturgy";

type Report = (_error: unknown, _operation: string, _properties?: Record<string, unknown>) => void;

/** Último pedaço do caminho, com `\` (Windows) ou `/`. */
function baseName(path: string): string {
  return decodeURIComponent(path.split(/[?#]/)[0].split(/[\\/]/).pop() || "");
}

/**
 * Bytes do arquivo de um item: o que o app guardou (`ref_id`) ou, no desktop,
 * o arquivo do disco pelo caminho salvo.
 */
export async function readItemFile(item: LiturgyItem): Promise<PackedFile | null> {
  if (item.ref_id) return readLiturgyFile(item.ref_id);
  if (!Platform.isDesktop || !item.dir) return null;
  const url = /^louvorja:\/\//i.test(item.dir) ? item.dir : $path.local(item.dir);
  const response = await fetchWithTimeout(url, { timeout: NET_TIMEOUT.MEDIA, source: "file" });
  if (!response.ok) return null;
  return { name: baseName(item.dir), data: await response.blob() };
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

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

/**
 * Exportar a liturgia que está na tela como `.llja`, com os arquivos dentro.
 */
export function useLiturgyExport(report: Report) {
  const { t } = useLiturgyI18n();
  const { busy, run } = useBusy();

  async function exportLiturgy(input: {
    name: string;
    color?: string;
    items: LiturgyItem[];
  }): Promise<void> {
    if (busy.value) return;
    if (!input.items.length) {
      $snackbar.warning(t("library.export_empty"));
      Telemetry.track("liturgy_operation_blocked", { operation: "export", reason: "empty" });
      return;
    }
    const result = await run(async () => {
      try {
        return await buildLlja(input, readItemFile);
      } catch (error) {
        report(error, "export", { format: LLJA_EXT });
        console.error("[Liturgia] export falhou:", error);
        return null;
      }
    });
    if (!result) {
      $snackbar.error(t("library.export_error"));
      return;
    }
    download(result.blob, `${safeFileName(input.name)}.${LLJA_EXT}`);
    Telemetry.track("liturgy_export_completed", {
      format: LLJA_EXT,
      item_count: input.items.length,
      missing_files: result.missing.length,
      local_only: result.localOnly.length,
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
