import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

interface HashRequest {
  id: number;
  file: Blob;
}

const scope = self as unknown as {
  onmessage: ((_event: MessageEvent<HashRequest>) => void) | null;
  postMessage: (_message: unknown) => void;
};

scope.onmessage = async (event: MessageEvent<HashRequest>) => {
  const { id, file } = event.data;
  try {
    const hash = sha256.create();
    const reader = file.stream().getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) hash.update(value);
      }
    } finally {
      reader.releaseLock();
    }
    scope.postMessage({ id, hash: bytesToHex(hash.digest()) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
