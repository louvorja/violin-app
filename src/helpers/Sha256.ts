import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Abaixo disto o @noble é mais rápido: cada `subtle.digest` é uma promessa que
 * sai da thread, e o bundle confere milhares de arquivos pequenos.
 */
const WEBCRYPTO_MIN_BYTES = 64 * 1024;

/** Mantém a integridade dos bundles e os tokens de mídia, com ou sem WebCrypto. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digest =
    bytes.byteLength >= WEBCRYPTO_MIN_BYTES && typeof subtle?.digest === "function"
      ? new Uint8Array(await subtle.digest("SHA-256", bytes))
      : sha256(bytes);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
