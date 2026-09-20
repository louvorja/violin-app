export type YouTubeErrorKind =
  | "invalid_parameter"
  | "html5_error"
  | "embed_not_allowed"
  | "video_not_found"
  | "unknown";

export interface NormalizedYouTubeError {
  message: string;
  code: number | null;
  kind: YouTubeErrorKind;
  name: string;
  properties: {
    youtube_error_code?: number;
    youtube_error_kind: YouTubeErrorKind;
  };
}

const CODE_MESSAGES: Record<number, { message: string; kind: YouTubeErrorKind }> = {
  2: { message: "Parâmetro inválido no vídeo do YouTube", kind: "invalid_parameter" },
  5: { message: "O player HTML5 não conseguiu reproduzir o vídeo", kind: "html5_error" },
  100: { message: "Vídeo do YouTube não encontrado ou removido", kind: "video_not_found" },
  101: { message: "O proprietário não permite a reprodução incorporada", kind: "embed_not_allowed" },
  150: { message: "O proprietário não permite a reprodução incorporada", kind: "embed_not_allowed" },
};

function finiteCode(value: unknown): number | null {
  const code = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof code === "number" && Number.isFinite(code) ? code : null;
}

function valueMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.message === "string" && object.message.trim()) return object.message.trim();
    if (typeof object.name === "string" && object.name.trim()) return object.name.trim();
  }
  return undefined;
}

/**
 * Normaliza erros do IFrame API sem serializar o objeto/evento inteiro.
 * Em particular, evita a mensagem `[object Object]` gerada por `String(e.data)`.
 */
export function normalizeYouTubeError(input: unknown): NormalizedYouTubeError {
  const root = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const data = root.data ?? input;
  const dataObject = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const code = finiteCode(dataObject.code ?? dataObject.errorCode ?? data);
  const known = code === null ? undefined : CODE_MESSAGES[code];
  const explicitMessage =
    valueMessage(dataObject.message) || valueMessage(root.message) || valueMessage(input);
  const name =
    valueMessage(dataObject.name) ||
    valueMessage(root.name) ||
    (input instanceof Error ? input.name : "YouTubeError");
  const kind = known?.kind || "unknown";
  const message = known?.message || explicitMessage || "Erro desconhecido do YouTube";

  return {
    message,
    code,
    kind,
    name,
    properties: {
      ...(code === null ? {} : { youtube_error_code: code }),
      youtube_error_kind: kind,
    },
  };
}

export default normalizeYouTubeError;
