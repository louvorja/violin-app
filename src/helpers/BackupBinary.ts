/** Bytes ficam em entradas ZIP; JSON guarda apenas referências tipadas. */
import type JSZip from "jszip";

const BINARY = "__louvorja_binary__";
const views: Record<string, (_buffer: ArrayBuffer) => ArrayBufferView> = {
  Int8Array: (buffer) => new Int8Array(buffer),
  Uint8Array: (buffer) => new Uint8Array(buffer),
  Uint8ClampedArray: (buffer) => new Uint8ClampedArray(buffer),
  Int16Array: (buffer) => new Int16Array(buffer),
  Uint16Array: (buffer) => new Uint16Array(buffer),
  Int32Array: (buffer) => new Int32Array(buffer),
  Uint32Array: (buffer) => new Uint32Array(buffer),
  Float32Array: (buffer) => new Float32Array(buffer),
  Float64Array: (buffer) => new Float64Array(buffer),
  BigInt64Array: (buffer) => new BigInt64Array(buffer),
  BigUint64Array: (buffer) => new BigUint64Array(buffer),
  DataView: (buffer) => new DataView(buffer),
};

interface BinaryReference {
  __louvorja_binary__: string;
  kind: string;
  size: number;
  mime?: string;
  name?: string;
  lastModified?: number;
}

export function createBackupEncoder(zip: JSZip) {
  let nextId = 0;
  return async (value: unknown): Promise<string> => {
    const pending: Array<{ path: string; value: Blob | ArrayBuffer }> = [];
    const json = JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (!item || typeof item !== "object") return item;
        // Não confundir dados do usuário com o marcador reservado do formato v2.
        if (Object.hasOwn(item, BINARY)) throw new Error("Campo reservado no backup");
        const isBlob = item instanceof Blob;
        const isBuffer = item instanceof ArrayBuffer;
        const isView = ArrayBuffer.isView(item);
        if (!isBlob && !isBuffer && !isView) return item;
        const path = `binary/${nextId++}.bin`;
        const kind = isBlob
          ? item instanceof File
            ? "File"
            : "Blob"
          : isBuffer
            ? "ArrayBuffer"
            : item.constructor.name;
        if (isView && !Object.hasOwn(views, kind)) throw new Error("Tipo binário não suportado");
        const bytes = isView
          ? new Uint8Array(new Uint8Array(item.buffer, item.byteOffset, item.byteLength)).buffer
          : item;
        pending.push({ path, value: bytes });
        const ref: BinaryReference = {
          [BINARY]: path,
          kind,
          size: isBlob ? item.size : item.byteLength,
        };
        if (isBlob) ref.mime = item.type;
        if (item instanceof File) {
          ref.name = item.name;
          ref.lastModified = item.lastModified;
        }
        return ref;
      },
      2
    );
    for (const entry of pending) {
      zip.file(
        entry.path,
        entry.value instanceof Blob ? await entry.value.arrayBuffer() : entry.value
      );
    }
    return json;
  };
}

export async function decodeBackupBinary(zip: JSZip, value: unknown): Promise<unknown> {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Promise.all(value.map((item) => decodeBackupBinary(zip, item)));
  if (!Object.hasOwn(value, BINARY)) {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [key, await decodeBackupBinary(zip, item)])
      )
    );
  }
  const ref = value as Partial<BinaryReference>;
  if (
    typeof ref[BINARY] !== "string" ||
    !/^binary\/\d+\.bin$/.test(ref[BINARY]) ||
    typeof ref.kind !== "string" ||
    (!["Blob", "File", "ArrayBuffer"].includes(ref.kind) && !Object.hasOwn(views, ref.kind)) ||
    typeof ref.size !== "number" ||
    !Number.isSafeInteger(ref.size) ||
    ref.size < 0 ||
    (["Blob", "File"].includes(ref.kind) && typeof ref.mime !== "string") ||
    (ref.kind === "File" &&
      (typeof ref.name !== "string" ||
        typeof ref.lastModified !== "number" ||
        !Number.isFinite(ref.lastModified)))
  )
    throw new Error("Referência binária inválida no backup");
  const entry = zip.file(ref[BINARY]);
  if (!entry) throw new Error(`Arquivo binário ausente no backup: ${ref[BINARY]}`);
  const original = (entry as { unsafeOriginalName?: string }).unsafeOriginalName;
  if (original && original !== ref[BINARY]) throw new Error("Caminho binário inválido no backup");
  const bytes = await entry.async("arraybuffer");
  if (bytes.byteLength !== ref.size) throw new Error("Tamanho binário inválido no backup");
  if (ref.kind === "Blob") return new Blob([bytes], { type: ref.mime });
  if (ref.kind === "File")
    return new File([bytes], ref.name!, { type: ref.mime, lastModified: ref.lastModified });
  if (ref.kind === "ArrayBuffer") return bytes;
  return views[ref.kind](bytes);
}
