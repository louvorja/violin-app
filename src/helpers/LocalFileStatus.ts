/**
 * Por que um arquivo local não abre.
 *
 * O `louvorja://local` responde 404 só quando o arquivo não existe; 403 é falta
 * de permissão e 5xx, disco que não lê (unidade de rede, pasta na nuvem sem
 * conexão). "Arquivo não encontrado" para esses casos mandava o operador
 * procurar um arquivo que estava lá.
 *
 * @category helper-puro — sem APIs Vue; só renderer (usa `fetch` e telemetria).
 */
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Telemetry from "@/helpers/Telemetry";
import { mediaDiagnosticLog, mediaDiagnosticMessage } from "@/helpers/MediaDiagnostics";

export type LocalFileStatus = "ok" | "not_found" | "permission" | "unreadable" | "timeout";

/** Por que um vídeo parou: o arquivo (local) ou o que veio dele. */
export type VideoFailure =
  | "network"
  | "not_found"
  | "permission"
  | "unreadable"
  | "format"
  | "decode";

export const VIDEO_FAILURE_HINT: Record<VideoFailure, string> = {
  network: "projection.video_unavailable_hint",
  not_found: "projection.video_unavailable_not_found",
  permission: "projection.video_unavailable_permission",
  unreadable: "projection.video_unavailable_unreadable",
  format: "projection.video_unavailable_format",
  decode: "projection.video_unavailable_decode",
};

export function isLocalFileUrl(url: unknown): url is string {
  return typeof url === "string" && /^louvorja:\/\/local\//i.test(url);
}

/** Pede 1 byte ao protocolo e lê o motivo pelo status. */
export async function localFileStatus(url: string): Promise<LocalFileStatus> {
  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      timeout: NET_TIMEOUT.QUICK,
      source: "file",
    });
    try {
      await response.body?.cancel();
    } catch {
      /* corpo de erro/cancelamento não interessa */
    }
    if (response.ok) return "ok";
    if (response.status === 404) return "not_found";
    if (response.status === 403) return "permission";
    return "unreadable";
  } catch (error) {
    return (error as { name?: string })?.name === "TimeoutError" ? "timeout" : "unreadable";
  }
}

/**
 * Motivo de um `<video>` que falhou. Para arquivo local, o protocolo é
 * consultado: o `<video>` diz "formato não suportado" (código 4) também quando
 * o arquivo simplesmente sumiu.
 */
export async function videoFailureReason(
  url: string,
  mediaErrorCode: number | undefined
): Promise<VideoFailure> {
  if (mediaErrorCode === 3) return "decode";
  if (url.startsWith("blob:")) return "format";
  if (!isLocalFileUrl(url)) return "network";
  const status = await localFileStatus(url);
  if (status === "ok") return mediaErrorCode === 2 ? "unreadable" : "format";
  return status === "timeout" ? "unreadable" : status;
}

/** Arquivo ausente é engano do operador; o resto é defeito a investigar. */
export function isSevereVideoFailure(failure: VideoFailure): boolean {
  return failure !== "not_found";
}

/**
 * Registra a falha de um `<video>` de arquivo já com o motivo: arquivo ausente
 * vai como aviso (evento e log), o resto também como exceção, para o error
 * tracking. O estado do elemento é lido antes da consulta ao disco — ele pode
 * ser reaproveitado por outra mídia enquanto ela corre.
 */
export async function reportVideoFailure(options: {
  el: HTMLVideoElement | null;
  url: string;
  label: string;
  event: string;
  operation: string;
  details: Record<string, unknown>;
}): Promise<VideoFailure> {
  const { el, url } = options;
  const code = el?.error?.code;
  const reason = code === 3 ? "decode" : code === 4 ? "source_not_supported" : "unknown";
  const snapshot = {
    ...options.details,
    reason,
    code,
    message: mediaDiagnosticMessage(el?.error?.message),
    ready_state: el?.readyState,
    network_state: el?.networkState,
  };
  const failure = await videoFailureReason(url, code);
  const severe = isSevereVideoFailure(failure);
  const details = { ...snapshot, failure };
  mediaDiagnosticLog(severe ? "error" : "warn", "file projection video failed", details);
  if (severe) {
    Telemetry.captureException(new Error(`${options.label} ${failure}`), {
      ...details,
      operation: options.operation,
    });
  }
  Telemetry.track(options.event, details);
  return failure;
}
