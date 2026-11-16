import { DB_TABLE } from "@/constants/DbTables";
import { heicToJpeg, isHeic } from "@/helpers/ImageConvert";
import $idb from "@/helpers/IndexedDB";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import {
  mediaBlobDetails,
  mediaDiagnosticMessage,
  mediaLibraryDetails,
  mediaSourceDetails,
} from "@/helpers/MediaDiagnostics";
import type { FileProjectionState } from "@/types/Media";

export interface ResolvedProjectedSource {
  payload: FileProjectionState;
  diagnostics: Record<string, unknown>;
  resolvedBlobUrl: string | null;
}

function _initialResolvedSource(payload: FileProjectionState): ResolvedProjectedSource {
  return {
    payload,
    diagnostics: {
      requested_source: {
        ...mediaSourceDetails(payload.url),
        ...mediaLibraryDetails(payload.libRef),
        blob_mime: "unknown",
        codec: "unknown",
      },
      blob_resolution: payload.url?.startsWith("blob:") ? "no_library_reference" : "not_requested",
    },
    resolvedBlobUrl: null,
  };
}

/** Resolve sincronamente quando não há blob de `libRef` nem conversão HEIC pendente. */
export function resolveProjectedFileSourceImmediate(
  payload: FileProjectionState
): ResolvedProjectedSource {
  return _initialResolvedSource(payload);
}

/**
 * Resolve `blob:` provenientes de outra janela via IndexedDB (`libRef`) e
 * converte imagens HEIC/HEIF na janela de destino antes da exibição.
 */
export async function resolveProjectedFileSource(
  payload: FileProjectionState
): Promise<ResolvedProjectedSource> {
  const initial = _initialResolvedSource(payload);
  let nextPayload = initial.payload;
  let resolvedBlobUrl: string | null = initial.resolvedBlobUrl;
  let diagnostics: Record<string, unknown> = initial.diagnostics;

  if (payload.libRef?.id && payload.url?.startsWith("blob:")) {
    try {
      const rec = await $idb.get<{ data?: Blob | ArrayBuffer; mime?: string; name?: string }>(
        payload.libRef.table || DB_TABLE.MEDIA_LIBRARY,
        payload.libRef.id
      );
      diagnostics.blob_resolution = "library_record_missing";
      if (rec?.data && rec.mime) {
        let blob = new Blob([rec.data], { type: rec.mime });
        if (payload.type === "image" && (payload.heic || isHeic(rec.name, rec.mime))) {
          blob = await heicToJpeg(blob);
        }
        diagnostics = {
          ...diagnostics,
          blob_resolution: "resolved",
          requested_source: {
            ...(diagnostics.requested_source as Record<string, unknown>),
            ...mediaBlobDetails(blob),
          },
        };
        resolvedBlobUrl = URL.createObjectURL(blob);
        nextPayload = { ...payload, url: resolvedBlobUrl };
      }
    } catch (error) {
      diagnostics.blob_resolution = "library_read_failed";
      console.warn(
        "[ProjectedFileSource] libRef resolve falhou:",
        mediaDiagnosticMessage(error instanceof Error ? error.message : String(error))
      );
    }
  }

  if (
    nextPayload.type === "image" &&
    nextPayload.heic &&
    !resolvedBlobUrl &&
    !nextPayload.url?.startsWith("blob:")
  ) {
    try {
      const response = await fetchWithTimeout(nextPayload.url, {
        timeout: NET_TIMEOUT.MEDIA,
        source: "file",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      resolvedBlobUrl = URL.createObjectURL(await heicToJpeg(await response.blob()));
      nextPayload = { ...nextPayload, url: resolvedBlobUrl };
    } catch (error) {
      diagnostics.blob_resolution = "heic_conversion_failed";
      console.warn("[ProjectedFileSource] conversão de HEIC falhou:", error);
      nextPayload = { ...nextPayload, url: "" };
    }
  }

  return { payload: nextPayload, diagnostics, resolvedBlobUrl };
}

export function needsProjectedSourceResolution(payload: FileProjectionState): boolean {
  return Boolean(
    (payload.libRef?.id && payload.url?.startsWith("blob:")) ||
      (payload.type === "image" && payload.heic && !payload.url?.startsWith("blob:"))
  );
}
