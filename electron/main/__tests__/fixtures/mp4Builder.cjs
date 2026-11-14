"use strict";

/**
 * MP4/MOV mínimos para os testes do audioRepair: só as caixas que o leitor
 * consulta, com quadros de áudio de bytes conhecidos espalhados pelo `mdat`.
 */

const u8 = (n) => Buffer.from([n & 0xff]);
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
const str = (s) => Buffer.from(s, "latin1");

function box(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => (typeof p === "string" ? str(p) : p)));
  return Buffer.concat([u32(body.length + 8), str(type), body]);
}

function fullbox(type, ...parts) {
  return box(type, u32(0), ...parts);
}

function descriptor(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([u8(tag), u8(body.length), body]);
}

function esds(asc, oti = 0x40) {
  return fullbox(
    "esds",
    descriptor(
      0x03,
      u16(1),
      u8(0),
      descriptor(0x04, u8(oti), u8(0x15), Buffer.alloc(3), u32(128000), u32(128000), descriptor(0x05, asc)),
      descriptor(0x06, u8(0x02))
    )
  );
}

function audioEntry({ codec = "mp4a", asc, channels = 2, qtVersion = 0 }) {
  const fixed = Buffer.concat([
    Buffer.alloc(6),
    u16(1),
    u16(qtVersion),
    u16(0),
    u32(0),
    u16(channels),
    u16(16),
    u16(0),
    u16(0),
    u32(48000 * 65536),
  ]);
  if (codec !== "mp4a") return box(codec, fixed);
  if (qtVersion === 1) {
    const wave = box("wave", box("frma", "mp4a"), box("mp4a", u32(0)), esds(asc), u32(8), u32(0));
    return box("mp4a", fixed, Buffer.alloc(16), wave);
  }
  return box("mp4a", fixed, esds(asc));
}

function trak(handler, entry, tables) {
  return box(
    "trak",
    box(
      "mdia",
      fullbox("mdhd", Buffer.alloc(20)),
      fullbox("hdlr", u32(0), str(handler), Buffer.alloc(12), str("x\0")),
      box("minf", box("stbl", fullbox("stsd", u32(1), entry), ...tables))
    )
  );
}

/**
 * @param {{
 *   sizes: number[],
 *   perChunk: number[],
 *   asc?: Buffer,
 *   channels?: number,
 *   codec?: string,
 *   qtVersion?: number,
 *   co64?: boolean,
 *   faststart?: boolean,
 *   fragmented?: boolean,
 * }} opts
 * @returns {{ file: Buffer, positions: number[], sizes: number[], frames: Buffer[] }}
 */
function buildMp4(opts) {
  const { sizes, perChunk } = opts;
  const asc = opts.asc || Buffer.from([0x11, 0x90]);
  const frames = sizes.map((size, i) => Buffer.alloc(size, (i % 250) + 1));
  const filler = Buffer.alloc(37, 0xee);

  const tables = (chunkOffsets) => {
    const uniform = sizes.every((s) => s === sizes[0]);
    const stsz = uniform
      ? fullbox("stsz", u32(sizes[0]), u32(sizes.length))
      : fullbox("stsz", u32(0), u32(sizes.length), ...sizes.map(u32));
    const stscEntries = [];
    perChunk.forEach((count, c) => {
      if (c === 0 || perChunk[c - 1] !== count) stscEntries.push([c + 1, count]);
    });
    const stsc = fullbox(
      "stsc",
      u32(stscEntries.length),
      ...stscEntries.flatMap(([first, count]) => [u32(first), u32(count), u32(1)])
    );
    const offsets = opts.co64
      ? fullbox("co64", u32(chunkOffsets.length), ...chunkOffsets.map(u64))
      : fullbox("stco", u32(chunkOffsets.length), ...chunkOffsets.map(u32));
    return [stsz, stsc, offsets];
  };
  const moovFor = (chunkOffsets) =>
    box(
      "moov",
      fullbox("mvhd", Buffer.alloc(96)),
      trak("vide", box("avc1", Buffer.alloc(78)), []),
      trak("soun", audioEntry({ ...opts, asc }), tables(chunkOffsets)),
      ...(opts.fragmented ? [box("mvex", fullbox("trex", Buffer.alloc(20)))] : [])
    );

  const ftyp = box("ftyp", "isom", u32(512), "isomiso2mp41");
  const mdatBody = [];
  const relativeChunks = [];
  const relativePositions = [];
  let at = 0;
  let sample = 0;
  for (const count of perChunk) {
    mdatBody.push(filler);
    at += filler.length;
    relativeChunks.push(at);
    for (let s = 0; s < count; s++) {
      relativePositions.push(at);
      mdatBody.push(frames[sample]);
      at += frames[sample].length;
      sample++;
    }
  }
  const mdat = box("mdat", ...mdatBody);
  const placeholder = moovFor(relativeChunks);
  const mdatStart = ftyp.length + (opts.faststart ? placeholder.length : 0) + 8;
  const moov = moovFor(relativeChunks.map((p) => p + mdatStart));
  const file = opts.faststart ? Buffer.concat([ftyp, moov, mdat]) : Buffer.concat([ftyp, mdat, moov]);
  return { file, positions: relativePositions.map((p) => p + mdatStart), sizes, frames };
}

module.exports = { buildMp4 };
