"use strict";

/**
 * Onde estão os quadros de áudio AAC de um MP4/MOV, lido só do índice (`moov`).
 *
 * Nenhum byte de mídia passa por aqui: a posição e o tamanho de cada quadro vêm
 * das tabelas de amostras, e quem decodifica é o renderer, com o mesmo
 * decodificador do player.
 */

const fs = require("node:fs");

const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const MAX_SAMPLES = 2_000_000;
const SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

class Mp4AudioUnsupported extends Error {
  constructor(reason, details = {}) {
    super(reason);
    this.name = "Mp4AudioUnsupported";
    this.reason = reason;
    this.details = details;
  }
}

async function _readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return bytesRead === len ? buf : buf.subarray(0, bytesRead);
}

async function _topLevelBox(fh, fileSize, type) {
  let pos = 0;
  while (pos + 8 <= fileSize) {
    const h = await _readAt(fh, pos, 16);
    if (h.length < 8) return null;
    let size = h.readUInt32BE(0);
    let header = 8;
    if (size === 1) {
      if (h.length < 16) return null;
      size = Number(h.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) {
      size = fileSize - pos;
    }
    if (size < header) return null;
    if (h.toString("latin1", 4, 8) === type) return { pos, size, header };
    pos += size;
  }
  return null;
}

function* _boxes(buf, start, end) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    yield { type: buf.toString("latin1", pos + 4, pos + 8), start: pos + header, end: pos + size };
    pos += size;
  }
}

function _child(buf, box, type) {
  for (const b of _boxes(buf, box.start, box.end)) if (b.type === type) return b;
  return null;
}

function _children(buf, box, type) {
  const found = [];
  for (const b of _boxes(buf, box.start, box.end)) if (b.type === type) found.push(b);
  return found;
}

function _path(buf, box, ...types) {
  let current = box;
  for (const type of types) {
    current = current && _child(buf, current, type);
  }
  return current;
}

function _handler(buf, trak) {
  const hdlr = _path(buf, trak, "mdia", "hdlr");
  return hdlr && hdlr.end - hdlr.start >= 12 ? buf.toString("latin1", hdlr.start + 8, hdlr.start + 12) : null;
}

/** Primeira entrada da `stsd`: o fourcc do codec e a caixa dela. */
function _sampleEntry(buf, trak) {
  const stsd = _path(buf, trak, "mdia", "minf", "stbl", "stsd");
  if (!stsd || stsd.end - stsd.start < 8) return null;
  const entry = _boxes(buf, stsd.start + 8, stsd.end).next().value;
  return entry || null;
}

/** `esds` direto na entrada (ISO) ou dentro de `wave` (QuickTime versão 1). */
function _findEsds(buf, start, end) {
  for (const b of _boxes(buf, start, end)) {
    if (b.type === "esds") return b;
    if (b.type === "wave") {
      const inner = _findEsds(buf, b.start, b.end);
      if (inner) return inner;
    }
  }
  return null;
}

function _descriptor(buf, p, end) {
  if (p + 2 > end) return null;
  const tag = buf[p++];
  let len = 0;
  for (let i = 0; i < 4 && p < end; i++) {
    const b = buf[p++];
    len = (len << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { tag, len, start: p };
}

function _ascFromEsds(buf, esds) {
  const end = esds.end;
  let p = esds.start + 4;
  let d = _descriptor(buf, p, end);
  if (!d || d.tag !== 0x03) return { oti: null, asc: null };
  p = d.start + 2;
  const flags = buf[p++];
  if (flags & 0x80) p += 2;
  if (flags & 0x40) p += 1 + buf[p];
  if (flags & 0x20) p += 2;
  d = _descriptor(buf, p, end);
  if (!d || d.tag !== 0x04 || d.start + 13 > end) return { oti: null, asc: null };
  const oti = buf[d.start];
  d = _descriptor(buf, d.start + 13, end);
  if (!d || d.tag !== 0x05 || d.start + d.len > end) return { oti, asc: null };
  return { oti, asc: Buffer.from(buf.subarray(d.start, d.start + d.len)) };
}

/** AudioSpecificConfig: perfil, frequência, canais e se há SBR (HE-AAC). */
function parseAudioSpecificConfig(asc) {
  let bit = 0;
  const left = () => asc.length * 8 - bit;
  const read = (n) => {
    if (left() < n) throw new Mp4AudioUnsupported("asc_truncated");
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = v * 2 + ((asc[bit >> 3] >> (7 - (bit & 7))) & 1);
      bit++;
    }
    return v;
  };
  let aot = read(5);
  if (aot === 31) aot = 32 + read(6);
  const sfi = read(4);
  const sampleRate = sfi === 15 ? read(24) : SAMPLE_RATES[sfi];
  const channels = read(4);
  let frameLength = 1024;
  let sbr = aot === 5 || aot === 29;
  if (aot === 2 && channels > 0 && left() >= 3) {
    if (read(1)) frameLength = 960;
    if (read(1)) read(14);
    read(1);
    if (left() >= 16 && read(11) === 0x2b7 && read(5) === 5 && left() >= 1) sbr = read(1) === 1;
  }
  return { aot, sampleRate, channels, frameLength, sbr };
}

function _sampleTable(buf, trak, fileSize) {
  const stbl = _path(buf, trak, "mdia", "minf", "stbl");
  if (!stbl) throw new Mp4AudioUnsupported("no_stbl");
  const stsz = _child(buf, stbl, "stsz");
  if (!stsz) throw new Mp4AudioUnsupported(_child(buf, stbl, "stz2") ? "stz2" : "no_stsz");
  const uniform = buf.readUInt32BE(stsz.start + 4);
  const count = buf.readUInt32BE(stsz.start + 8);
  if (count === 0) throw new Mp4AudioUnsupported("no_samples");
  if (count > MAX_SAMPLES) throw new Mp4AudioUnsupported("too_many_samples");
  const sizes = new Uint32Array(count);
  if (uniform) sizes.fill(uniform);
  else {
    if (stsz.start + 12 + count * 4 > stsz.end) throw new Mp4AudioUnsupported("stsz_truncated");
    for (let i = 0; i < count; i++) sizes[i] = buf.readUInt32BE(stsz.start + 12 + i * 4);
  }

  const stco = _child(buf, stbl, "stco");
  const co64 = stco ? null : _child(buf, stbl, "co64");
  const offsetsBox = stco || co64;
  if (!offsetsBox) throw new Mp4AudioUnsupported("no_chunk_offsets");
  const chunkCount = buf.readUInt32BE(offsetsBox.start + 4);
  const width = stco ? 4 : 8;
  if (offsetsBox.start + 8 + chunkCount * width > offsetsBox.end)
    throw new Mp4AudioUnsupported("chunk_offsets_truncated");
  const chunkOffsets = new Float64Array(chunkCount);
  for (let c = 0; c < chunkCount; c++) {
    const at = offsetsBox.start + 8 + c * width;
    chunkOffsets[c] = stco ? buf.readUInt32BE(at) : Number(buf.readBigUInt64BE(at));
  }

  const stsc = _child(buf, stbl, "stsc");
  if (!stsc) throw new Mp4AudioUnsupported("no_stsc");
  const stscCount = buf.readUInt32BE(stsc.start + 4);
  if (stsc.start + 8 + stscCount * 12 > stsc.end) throw new Mp4AudioUnsupported("stsc_truncated");

  const positions = new Float64Array(count);
  let i = 0;
  for (let e = 0; e < stscCount && i < count; e++) {
    const at = stsc.start + 8 + e * 12;
    const firstChunk = buf.readUInt32BE(at);
    const perChunk = buf.readUInt32BE(at + 4);
    const nextFirst = e + 1 < stscCount ? buf.readUInt32BE(at + 12) : chunkCount + 1;
    for (let c = firstChunk; c < nextFirst && c <= chunkCount && i < count; c++) {
      let offset = chunkOffsets[c - 1];
      for (let s = 0; s < perChunk && i < count; s++) {
        positions[i] = offset;
        offset += sizes[i];
        i++;
      }
    }
  }
  if (i !== count) throw new Mp4AudioUnsupported("sample_table_mismatch");
  for (let k = 0; k < count; k++) {
    if (positions[k] + sizes[k] > fileSize) throw new Mp4AudioUnsupported("sample_outside_file");
  }

  // Menor posição a partir de cada amostra: o que ainda não foi conferido
  // começa, no arquivo, em `minFrom[próxima]` — mesmo que a ordem das amostras
  // não siga a ordem dos bytes.
  const minFrom = new Float64Array(count);
  let min = Infinity;
  for (let k = count - 1; k >= 0; k--) {
    if (positions[k] < min) min = positions[k];
    minFrom[k] = min;
  }
  return { positions, sizes, minFrom };
}

/**
 * Faixa de áudio AAC-LC (mono ou estéreo) do arquivo, com as posições de cada
 * quadro. Qualquer outro formato lança `Mp4AudioUnsupported` com o motivo e,
 * quando há, os codecs encontrados — o que já diz por que um vídeo não abre.
 *
 * @param {string} caminho
 * @param {number} fileSize
 */
async function readAudioTrack(caminho, fileSize) {
  const fh = await fs.promises.open(caminho, "r");
  try {
    const moovBox = await _topLevelBox(fh, fileSize, "moov");
    if (!moovBox) throw new Mp4AudioUnsupported("no_moov");
    if (moovBox.size > MAX_MOOV_BYTES) throw new Mp4AudioUnsupported("moov_too_large");
    const buf = await _readAt(fh, moovBox.pos, moovBox.size);
    if (buf.length < moovBox.size) throw new Mp4AudioUnsupported("moov_truncated");
    const moov = { start: moovBox.header, end: buf.length };
    if (_child(buf, moov, "mvex")) throw new Mp4AudioUnsupported("fragmented");

    const traks = _children(buf, moov, "trak");
    const videoTrak = traks.find((t) => _handler(buf, t) === "vide");
    const audioTrak = traks.find((t) => _handler(buf, t) === "soun");
    const codecs = {
      video_codec: (videoTrak && _sampleEntry(buf, videoTrak)?.type) || null,
      audio_codec: (audioTrak && _sampleEntry(buf, audioTrak)?.type) || null,
    };
    if (!audioTrak) throw new Mp4AudioUnsupported("no_audio_track", codecs);
    const entry = _sampleEntry(buf, audioTrak);
    if (!entry || entry.type !== "mp4a") throw new Mp4AudioUnsupported("audio_codec", codecs);

    const version = entry.end - entry.start >= 10 ? buf.readUInt16BE(entry.start + 8) : 0;
    const childStart = entry.start + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
    const esds = childStart < entry.end ? _findEsds(buf, childStart, entry.end) : null;
    if (!esds) throw new Mp4AudioUnsupported("no_esds", codecs);
    const { oti, asc } = _ascFromEsds(buf, esds);
    if (oti !== 0x40 || !asc) throw new Mp4AudioUnsupported("not_mpeg4_audio", codecs);
    const config = parseAudioSpecificConfig(asc);
    if (config.aot !== 2 || config.sbr) throw new Mp4AudioUnsupported("aac_profile", codecs);
    if (config.channels !== 1 && config.channels !== 2)
      throw new Mp4AudioUnsupported("aac_channels", codecs);
    if (!config.sampleRate) throw new Mp4AudioUnsupported("aac_sample_rate", codecs);

    let table;
    try {
      table = _sampleTable(buf, audioTrak, fileSize);
    } catch (error) {
      if (error instanceof Mp4AudioUnsupported) error.details = { ...codecs, ...error.details };
      throw error;
    }
    return { ...codecs, ...config, asc, ...table };
  } finally {
    await fh.close().catch(() => {});
  }
}

module.exports = { readAudioTrack, parseAudioSpecificConfig, Mp4AudioUnsupported };
