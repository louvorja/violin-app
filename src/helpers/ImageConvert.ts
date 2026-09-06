/**
 * ImageConvert.ts — Conversão de imagens que o Chromium não decodifica
 * nativamente (HEIC/HEIF — fotos de iPhone) para JPEG no momento da
 * importação, garantindo que thumb, preview e projeção funcionem.
 *
 * heic2any (libheif WASM) vem do bundle, então funciona offline em
 * Electron/Web/PWA, mas entra sob demanda: são 1,3MB e ele cria workers assim
 * que é avaliado. Estático, esse peso descia — e os workers subiam — em toda
 * tela que só queria saber se um arquivo é HEIC, coisa que `isHeic` responde
 * com uma expressão regular.
 *
 * @category helper-puro — Sem APIs Vue; sem acesso ao store.
 */

/** Detecta HEIC/HEIF pela extensão do nome ou pelo mime. */
export function isHeic(name?: string | null, mime?: string | null): boolean {
  if (mime && /^image\/hei[cf]$/i.test(mime)) return true;
  if (!name) return false;
  return /\.(heic|heif)$/i.test(name);
}

/**
 * Converte um blob HEIC/HEIF para JPEG (quality 0.92).
 * Rejeita se a conversão falhar — o chamador decide manter o original.
 */
export async function heicToJpeg(source: Blob): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const result = await heic2any({
    blob: source,
    toType: "image/jpeg",
    quality: 0.92,
  });
  return Array.isArray(result) ? result[0] : result;
}

/**
 * Garante uma imagem renderizável: se o arquivo for HEIC/HEIF, converte para
 * JPEG e ajusta a extensão do nome. Caso contrário devolve os dados originais.
 *
 * @param name   Nome do arquivo (ex.: "IMG_0001.heic").
 * @param source Blob com os bytes da imagem.
 * @returns { blob, name } prontos para importação/registro.
 */
export async function ensureRenderableImage(
  name: string,
  source: Blob
): Promise<{ blob: Blob; name: string }> {
  if (!isHeic(name)) return { blob: source, name };
  const converted = await heicToJpeg(source);
  const base = name.replace(/\.(heic|heif)$/i, "");
  return { blob: converted, name: `${base}.jpg` };
}

export default { isHeic, heicToJpeg, ensureRenderableImage };
