/**
 * Bytes de um registro que pode vir em três formas: `Blob` (novo), `ArrayBuffer`
 * (legado) ou uma view (`Uint8Array`, inclusive de outro realm do IndexedDB).
 *
 * `instanceof` não serve para dado vindo do IndexedDB: o objeto pode ter sido
 * criado em outro realm e falhar no teste mesmo sendo um ArrayBuffer de verdade.
 * Por isso a checagem é pela marca do objeto.
 *
 * @category helper-puro — sem Vue, sem IndexedDB.
 */

function isBlobLike(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/** Tamanho em bytes, ou 0 quando a forma não é reconhecida. */
export function byteSize(value: unknown): number {
  if (!value) return 0;
  if (isBlobLike(value)) return value.size;
  if (isArrayBufferLike(value)) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

/** Blob a partir de qualquer uma das formas guardadas. */
export function blobOf(value: unknown, mime = ""): Blob | null {
  if (!value) return null;
  if (isBlobLike(value)) {
    if (!value.size) return null;
    return value.type || !mime ? value : new Blob([value], { type: mime });
  }
  if (isArrayBufferLike(value)) {
    return value.byteLength ? new Blob([value], { type: mime }) : null;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength ? new Blob([value as BlobPart], { type: mime }) : null;
  }
  return null;
}

/**
 * Lê um stream inteiro para Blob, com teto e conferência de tamanho.
 *
 * O leitor é cancelado em erro para o produtor (ZIP/arquivo) não continuar
 * escrevendo num consumidor que já desistiu.
 */
export async function blobFromStream(
  stream: ReadableStream<Uint8Array>,
  options: { expectedSize?: number; maxBytes?: number; mime?: string } = {}
): Promise<Blob> {
  const { expectedSize = 0, maxBytes = Number.POSITIVE_INFINITY, mime = "" } = options;
  const chunks: BlobPart[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("too_large");
      chunks.push(value as BlobPart);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (expectedSize > 0 && total !== expectedSize) throw new Error("incomplete_file");
  return new Blob(chunks, { type: mime });
}
