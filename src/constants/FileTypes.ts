import presentationExtensions from "../../electron/shared/presentationExtensions.json";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "heic", "heif"];
export const AUDIO_EXT = ["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"];
export const VIDEO_EXT = ["mp4", "webm", "mkv", "mov", "avi", "m4v"];

/**
 * Apresentações aceitas — a mesma lista do main (`electron/shared/`).
 * `.ppt/.pps/.pptm/.ppsm` podem carregar macros: quem abre confirma antes.
 */
export const PPT_EXT: readonly string[] = presentationExtensions.powerPoint;
export const PPT_MACRO_EXT: readonly string[] = presentationExtensions.macroEnabled;
/** Valor do `accept` do `<input type="file">`. */
export const PPT_ACCEPT = PPT_EXT.map((e) => "." + e).join(",");
/** O que o celular pode enviar: macro não vem de lá (não há quem confirme). */
export const PPT_PHONE_EXT = PPT_EXT.filter((e) => !PPT_MACRO_EXT.includes(e));
export const PPT_PHONE_ACCEPT = PPT_PHONE_EXT.map((e) => "." + e).join(",");

/** A extensão (sem ponto, minúscula) é uma apresentação? */
export function isPowerPointExt(ext: string | null | undefined): boolean {
  return !!ext && PPT_EXT.includes(ext.toLowerCase());
}

/** O nome de arquivo é uma apresentação? */
export function isPowerPointName(name: string | undefined | null): boolean {
  const text = String(name || "");
  if (!text.includes(".")) return false;
  return isPowerPointExt(text.split(".").pop() ?? "");
}

/** A apresentação pode conter macros? (pede confirmação antes de abrir) */
export function isMacroEnabledExt(ext: string | null | undefined): boolean {
  return !!ext && PPT_MACRO_EXT.includes(ext.toLowerCase());
}

export function isMacroEnabledName(name: string | undefined | null): boolean {
  const text = String(name || "");
  if (!text.includes(".")) return false;
  return isMacroEnabledExt(text.split(".").pop() ?? "");
}
