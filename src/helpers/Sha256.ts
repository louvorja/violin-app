import { sha256 } from "@noble/hashes/sha2.js";

/** Mantém a integridade dos bundles e os tokens de mídia quando WebCrypto não está disponível. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digest =
    typeof subtle?.digest === "function"
      ? new Uint8Array(await subtle.digest("SHA-256", bytes))
      : sha256(bytes);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
