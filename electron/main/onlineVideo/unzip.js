"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipError";
  }
}

async function readAt(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new ZipError("zip truncado");
    offset += bytesRead;
  }
  return buffer;
}

function targetFor(root, name) {
  const clean = path.posix.normalize(name.replace(/\\/g, "/"));
  if (!clean || clean === "." || clean.startsWith("../") || path.posix.isAbsolute(clean) || clean.includes(":")) {
    throw new ZipError(`caminho inválido no zip: ${name}`);
  }
  const dest = path.resolve(root, clean);
  if (dest !== root && !dest.startsWith(root + path.sep)) throw new ZipError(`caminho fora da pasta: ${name}`);
  return dest;
}

function readCentralDirectory(buffer, count) {
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== CENTRAL_SIGNATURE) {
      throw new ZipError("diretório central inválido");
    }
    const nameLength = buffer.readUInt16LE(p + 28);
    const flags = buffer.readUInt16LE(p + 8);
    entries.push({
      madeBy: buffer.readUInt16LE(p + 4) >> 8,
      flags,
      method: buffer.readUInt16LE(p + 10),
      crc: buffer.readUInt32LE(p + 16),
      compressedSize: buffer.readUInt32LE(p + 20),
      size: buffer.readUInt32LE(p + 24),
      external: buffer.readUInt32LE(p + 38),
      localOffset: buffer.readUInt32LE(p + 42),
      name: buffer.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLength),
    });
    p += 46 + nameLength + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
  return entries;
}

/** Copia uma entrada para `dest` em fluxo, conferindo tamanho e CRC no caminho. */
async function writeEntry(file, entry, dataStart, dest, mode) {
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`compressão ${entry.method} não suportada`);
  let crc = 0;
  let length = 0;
  const check = new Transform({
    transform(chunk, _encoding, callback) {
      crc = zlib.crc32(chunk, crc);
      length += chunk.length;
      callback(null, chunk);
    },
  });
  const stages = [];
  if (entry.compressedSize > 0) {
    stages.push(fs.createReadStream(file, { start: dataStart, end: dataStart + entry.compressedSize - 1 }));
    if (entry.method === 8) stages.push(zlib.createInflateRaw());
  } else {
    stages.push(async function* () {}());
  }
  try {
    await pipeline(...stages, check, fs.createWriteStream(dest, { mode }));
  } catch (error) {
    await fs.promises.rm(dest, { force: true });
    throw new ZipError(`falha ao extrair ${entry.name}: ${error.message}`);
  }
  if (length !== entry.size || crc !== entry.crc) {
    await fs.promises.rm(dest, { force: true });
    throw new ZipError(`conteúdo corrompido: ${entry.name}`);
  }
  return length;
}

/**
 * Extrai `file` para `destDir`, uma entrada por vez e em fluxo: nem o zip nem um
 * arquivo dele inteiro passam pela memória do main (o maior do yt-dlp tem ~15 MB).
 * A descompactação roda no pool de threads do libuv.
 *
 * @param {string} file
 * @param {string} destDir
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ files: number, bytes: number }>}
 */
async function extractZip(file, destDir, { signal } = {}) {
  const root = path.resolve(destDir);
  const handle = await fs.promises.open(file, "r");
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, EOCD_SIZE + MAX_COMMENT);
    const tail = await readAt(handle, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError("zip sem diretório central");
    const count = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new ZipError("zip64 não suportado");
    }
    if (centralOffset + centralSize > size) throw new ZipError("zip truncado");
    const entries = readCentralDirectory(await readAt(handle, centralSize, centralOffset), count);

    let files = 0;
    let bytes = 0;
    for (const entry of entries) {
      if (signal?.aborted) throw new ZipError("cancelado");
      if (entry.flags & 0x1) throw new ZipError("zip cifrado");
      const unixMode = entry.madeBy === 3 ? entry.external >>> 16 : 0;
      const type = unixMode & 0o170000;
      if (type === 0o120000) throw new ZipError(`link simbólico no zip: ${entry.name}`);
      const dest = targetFor(root, entry.name);
      if (entry.name.endsWith("/") || type === 0o040000) {
        await fs.promises.mkdir(dest, { recursive: true });
        continue;
      }

      const local = await readAt(handle, 30, entry.localOffset);
      if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new ZipError("cabeçalho local inválido");
      const dataStart = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (dataStart + entry.compressedSize > size) throw new ZipError("zip truncado");
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      const permissions = unixMode & 0o777;
      bytes += await writeEntry(file, entry, dataStart, dest, permissions ? permissions | 0o600 : 0o644);
      files++;
    }
    return { files, bytes };
  } finally {
    await handle.close();
  }
}

module.exports = { extractZip, ZipError };
