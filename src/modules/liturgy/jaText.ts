/**
 * Decodifica um `liturgia.ja` do jeito que o clássico faz (`garanteUtf8Liturgia`):
 * até a v26.6 ele gravava Windows-1252 sem BOM; da v26.7 (maio de 2026) em
 * diante, UTF-8 com BOM. Ler tudo como Windows-1252 grudava o BOM no `[Geral]`
 * e o arquivo inteiro era recusado.
 *
 * Sem BOM, tenta UTF-8 estrito antes: texto com acento em Windows-1252 quase
 * nunca é UTF-8 válido (`ç` = 0xE7 seguido de ASCII já não é).
 */
export function decodeJaText(buffer: ArrayBuffer): {
  text: string;
  encoding: "utf8-bom" | "utf8" | "cp1252";
} {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    // O decodificador UTF-8 já descarta o BOM.
    return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf8-bom" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "cp1252" };
  }
}
