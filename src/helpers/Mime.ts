/**
 * MIME por extensão, para registros guardados no IndexedDB.
 *
 * O `File.type` do navegador pode vir vazio (arrastar de alguns gerenciadores,
 * HEIC, extensões incomuns). Sem um MIME o Blob até é guardado, mas a URL
 * recriada depois de recarregar não tem tipo — e a projeção/áudio falha sem
 * dizer por quê. O mapa cobre as extensões que as bibliotecas aceitam.
 *
 * @category helper-puro — sem Vue, sem IndexedDB.
 */
const BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  wma: "audio/x-ms-wma",
  opus: "audio/ogg",
  pdf: "application/pdf",
  slja: "application/x-louvorja-slja",
};

export function mimeForName(name: string, fallback = "application/octet-stream"): string {
  const ext =
    String(name || "")
      .split(".")
      .pop()
      ?.toLowerCase() || "";
  return BY_EXT[ext] || fallback;
}

const EXT_BY_MIME: Record<string, string> = {};
for (const [ext, mime] of Object.entries(BY_EXT)) {
  if (!EXT_BY_MIME[mime]) EXT_BY_MIME[mime] = ext;
}

/** Extensão padrão de um MIME (para registros antigos sem nome com extensão). */
export function extensionForMime(mime: string, fallback = "bin"): string {
  const base = String(mime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return EXT_BY_MIME[base] || fallback;
}
