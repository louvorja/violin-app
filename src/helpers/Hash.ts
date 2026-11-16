/**
 * Hash de um Blob/File fora da thread principal.
 *
 * Arquivos grandes (5 GB) não podem passar por SHA-256 em JS na thread da UI:
 * a tela congelaria. O worker lê o `File` do OPFS em stream e devolve o hex.
 * Para ambientes sem `Worker` (testes Node), cai no cálculo na thread atual.
 *
 * @category helper-puro — usa Web Worker.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

interface HashReply {
  id: number;
  hash?: string;
  error?: string;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  {
    resolve: (_hash: string) => void;
    reject: (_error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const HASH_TIMEOUT_MS = 10 * 60 * 1000;

function workerInstance(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../workers/hash.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
  worker.onmessage = (event: MessageEvent<HashReply>) => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    clearTimeout(waiter.timer);
    if (reply.hash) waiter.resolve(reply.hash);
    else waiter.reject(new Error(reply.error || "hash_failed"));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "hash_worker_failed");
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
    worker = null;
  };
  return worker;
}

async function hashOnMainThread(blob: Blob): Promise<string> {
  const hash = sha256.create();
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return bytesToHex(hash.digest());
}

/** SHA-256 do conteúdo; `null` se o worker falhar. */
/** Envolve um stream calculando SHA-256 à medida que ele passa. */
export function createHashTap(stream: ReadableStream<Uint8Array>): {
  stream: ReadableStream<Uint8Array>;
  digest: () => string;
} {
  const hash = sha256.create();
  const tapped = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hash.update(chunk);
        controller.enqueue(chunk);
      },
    })
  );
  return { stream: tapped, digest: () => bytesToHex(hash.digest()) };
}

/** SHA-256 de um stream na thread atual (usado só para comparar antes de gravar). */
export async function hashStream(stream: ReadableStream<Uint8Array>): Promise<string | null> {
  try {
    const hash = sha256.create();
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) hash.update(value);
      }
    } finally {
      reader.releaseLock();
    }
    return bytesToHex(hash.digest());
  } catch {
    return null;
  }
}

export async function hashBlob(blob: Blob): Promise<string | null> {
  const instance = workerInstance();
  if (!instance) {
    try {
      return await hashOnMainThread(blob);
    } catch {
      return null;
    }
  }
  const id = ++nextId;
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, HASH_TIMEOUT_MS);
    pending.set(id, {
      resolve: (hash) => resolve(hash),
      reject: () => resolve(null),
      timer,
    });
    instance.postMessage({ id, file: blob });
  });
}
