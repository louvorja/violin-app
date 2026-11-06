"use strict";

/**
 * Quadros de áudio que o Chromium rejeita, trocados por silêncio na entrega.
 *
 * O Chromium encerra o `<video>` inteiro por UM quadro AAC que o FFmpeg recusa;
 * VLC e o próprio `ffmpeg` só pulam o quadro. Não há opção para tolerar, então
 * o renderer confere o áudio com o mesmo decodificador do player (WebCodecs) e
 * informa aqui quais quadros falharam. O protocolo `louvorja://` entrega, no
 * lugar deles, um quadro AAC de silêncio completado com zeros até o mesmo
 * tamanho: o índice do MP4 continua válido, o arquivo do usuário não muda e
 * cada quadro trocado perde ~21 ms de áudio — o mesmo que o VLC descarta.
 *
 * Enquanto a varredura de um arquivo corre, o protocolo não entrega bytes além
 * do ponto já conferido. A espera é limitada: varredura parada ou lenta demais
 * libera a entrega como ela era antes (nunca fica pior que sem isto).
 */

const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { readAudioTrack, Mp4AudioUnsupported } = require("./mp4AudioTrack.js");

/** raw_data_block AAC-LC sem espectro (max_sfb = 0), decodifica em silêncio. */
const SILENT_FRAMES = {
  1: Buffer.from([0x00, 0xc8, 0x00, 0x80, 0x23, 0x80]),
  2: Buffer.from([0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x80]),
};
const CHUNK_WAIT_MAX_MS = 2500;
const SCAN_STALL_MS = 1500;
const SCAN_TTL_MS = 10 * 60 * 1000;
const MAX_READ_SAMPLES = 2000;

/** caminho → estado do arquivo nesta sessão */
const _files = new Map();
/** token → varredura em curso */
const _scans = new Map();

function _sameFile(entry, stat) {
  return entry.size === stat.size && entry.mtimeMs === stat.mtimeMs;
}

function _wake(entry) {
  for (const waiter of entry.waiters) {
    if (entry.state !== "scanning" || entry.frontier >= waiter.until) {
      clearTimeout(waiter.timer);
      entry.waiters.delete(waiter);
      waiter.resolve();
    }
  }
}

function _finish(token, state) {
  const scan = _scans.get(token);
  if (!scan) return;
  _scans.delete(token);
  clearInterval(scan.watchdog);
  scan.fh.close().catch(() => {});
  scan.entry.state = state;
  if (state === "done") scan.entry.frontier = Infinity;
  _wake(scan.entry);
}

/** Bytes que substituem um quadro: silêncio + zeros até o tamanho original. */
function _replacement(entry, size) {
  const bytes = Buffer.alloc(size);
  entry.silentFrame.copy(bytes, 0);
  return bytes;
}

/**
 * Começa (ou reaproveita) a conferência do áudio de um arquivo local.
 *
 * @param {string} caminho
 * @returns {Promise<Record<string, unknown>>}
 */
async function begin(caminho) {
  let stat;
  try {
    stat = await fs.promises.stat(caminho);
  } catch {
    return { state: "unsupported", reason: "not_found" };
  }
  if (!stat.isFile()) return { state: "unsupported", reason: "not_file" };

  const known = _files.get(caminho);
  if (known && _sameFile(known, stat) && known.state !== "aborted") {
    if (known.state === "scanning") return { state: "scanning" };
    return {
      state: known.state,
      reason: known.reason,
      patched: known.patches.length,
      video_codec: known.video_codec,
      audio_codec: known.audio_codec,
    };
  }

  let track;
  try {
    track = await readAudioTrack(caminho, stat.size);
  } catch (error) {
    const reason = error instanceof Mp4AudioUnsupported ? error.reason : "read_failed";
    const details = (error instanceof Mp4AudioUnsupported && error.details) || {};
    _files.set(caminho, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      state: "unsupported",
      reason,
      patches: [],
      waiters: new Set(),
      video_codec: details.video_codec || null,
      audio_codec: details.audio_codec || null,
    });
    return { state: "unsupported", reason, ...details };
  }

  const fh = await fs.promises.open(caminho, "r");
  const entry = {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    state: "scanning",
    frontier: track.minFrom[0],
    patches: [],
    waiters: new Set(),
    silentFrame: SILENT_FRAMES[track.channels],
    progressAt: Date.now(),
    video_codec: track.video_codec,
    audio_codec: track.audio_codec,
  };
  _files.set(caminho, entry);
  const token = randomUUID();
  const startedAt = Date.now();
  const scan = { entry, track, fh, next: 0, unpatchable: 0 };
  scan.watchdog = setInterval(() => {
    const now = Date.now();
    if (now - entry.progressAt > SCAN_STALL_MS || now - startedAt > SCAN_TTL_MS) {
      console.warn("[audioRepair] varredura parada; entrega liberada:", caminho);
      _finish(token, "aborted");
    }
  }, 500);
  scan.watchdog.unref?.();
  _scans.set(token, scan);

  return {
    state: "scan",
    token,
    codec: "mp4a.40.2",
    sampleRate: track.sampleRate,
    numberOfChannels: track.channels,
    description: new Uint8Array(track.asc),
    count: track.positions.length,
    frameDurationUs: (track.frameLength * 1_000_000) / track.sampleRate,
    video_codec: track.video_codec,
    audio_codec: track.audio_codec,
  };
}

/**
 * Bytes dos quadros `[from, from + count)`, em sequência.
 *
 * @returns {Promise<{ data: Uint8Array, sizes: number[] } | null>}
 */
async function read(token, from, count) {
  const scan = _scans.get(token);
  if (!scan || !Number.isSafeInteger(from) || !Number.isSafeInteger(count)) return null;
  const { positions, sizes } = scan.track;
  const start = Math.max(0, from);
  const end = Math.min(positions.length, start + Math.max(0, Math.min(count, MAX_READ_SAMPLES)));
  let total = 0;
  for (let i = start; i < end; i++) total += sizes[i];
  const data = new Uint8Array(total);
  let written = 0;
  let i = start;
  while (i < end) {
    // Quadros vizinhos no arquivo viram uma leitura só.
    const runPos = positions[i];
    let runLen = sizes[i];
    let j = i + 1;
    while (j < end && positions[j] === runPos + runLen) runLen += sizes[j++];
    const { bytesRead } = await scan.fh.read(data, written, runLen, runPos);
    if (bytesRead !== runLen) return null;
    written += runLen;
    i = j;
  }
  scan.entry.progressAt = Date.now();
  return { data, sizes: Array.from(sizes.subarray(start, end)) };
}

/**
 * O renderer conferiu os quadros até `upto` (exclusive); `bad` são os que o
 * decodificador recusou.
 */
function report(token, result) {
  const scan = _scans.get(token);
  if (!scan) return { ok: false };
  const r = result && typeof result === "object" ? result : {};
  if (r.abort === true) {
    _finish(token, "aborted");
    return { ok: true };
  }
  const { positions, sizes, minFrom } = scan.track;
  const count = positions.length;
  const upto = Number.isSafeInteger(r.upto) ? Math.min(count, Math.max(scan.next, r.upto)) : scan.next;
  const bad = Array.isArray(r.bad) ? r.bad : [];
  const entry = scan.entry;
  let added = false;
  for (const index of bad) {
    if (!Number.isSafeInteger(index) || index < scan.next || index >= upto) continue;
    if (sizes[index] < entry.silentFrame.length) {
      scan.unpatchable++;
      continue;
    }
    entry.patches.push({ pos: positions[index], size: sizes[index] });
    added = true;
  }
  if (added) entry.patches.sort((a, b) => a.pos - b.pos);
  scan.next = upto;
  entry.frontier = upto >= count ? Infinity : minFrom[upto];
  entry.progressAt = Date.now();
  const unpatchable = scan.unpatchable;
  if (upto >= count || r.done === true) _finish(token, "done");
  else _wake(entry);
  return { ok: true, patched: entry.patches.length, unpatchable };
}

/**
 * O que o protocolo precisa saber para entregar o arquivo: `null` quando não
 * há nada a trocar nem varredura em curso — a entrega segue como sempre foi.
 *
 * @param {string} caminho
 * @param {{ size: number, mtimeMs: number }} stat
 */
function forFile(caminho, stat) {
  const entry = _files.get(caminho);
  if (!entry || !_sameFile(entry, stat)) return null;
  if (entry.state !== "scanning" && entry.patches.length === 0) return null;
  return {
    /** Resolve quando os bytes até `until` (exclusive) já foram conferidos. */
    waitFor(until) {
      if (entry.state !== "scanning" || entry.frontier >= until) return null;
      return new Promise((resolve) => {
        const waiter = { until, resolve };
        waiter.timer = setTimeout(() => {
          entry.waiters.delete(waiter);
          resolve();
        }, CHUNK_WAIT_MAX_MS);
        entry.waiters.add(waiter);
      });
    },
    /** Troca, dentro do pedaço `chunk` que começa em `pos`, os quadros recusados. */
    apply(chunk, pos) {
      const patches = entry.patches;
      if (patches.length === 0) return;
      const end = pos + chunk.length;
      let lo = 0;
      let hi = patches.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (patches[mid].pos + patches[mid].size <= pos) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < patches.length && patches[k].pos < end; k++) {
        const p = patches[k];
        const bytes = p.bytes || (p.bytes = _replacement(entry, p.size));
        const from = Math.max(pos, p.pos);
        const to = Math.min(end, p.pos + p.size);
        bytes.copy(chunk, from - pos, from - p.pos, to - p.pos);
      }
    },
  };
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {(url: string) => string | null} localPathFromUrl
 */
function registerIpc(ipcMain, localPathFromUrl) {
  ipcMain.handle("audioRepair:begin", async (_event, url) => {
    const caminho = typeof url === "string" ? localPathFromUrl(url) : null;
    if (!caminho) return { state: "unsupported", reason: "not_local" };
    try {
      return await begin(caminho);
    } catch (error) {
      console.warn("[audioRepair] begin falhou:", error?.message || error);
      return { state: "unsupported", reason: "begin_failed" };
    }
  });
  ipcMain.handle("audioRepair:read", (_event, token, from, count) =>
    typeof token === "string" ? read(token, from, count).catch(() => null) : null
  );
  ipcMain.handle("audioRepair:report", (_event, token, result) =>
    typeof token === "string" ? report(token, result) : { ok: false }
  );
}

function _resetForTests() {
  for (const token of [..._scans.keys()]) _finish(token, "aborted");
  _files.clear();
}

module.exports = {
  begin,
  read,
  report,
  forFile,
  registerIpc,
  SILENT_FRAMES,
  CHUNK_WAIT_MAX_MS,
  SCAN_STALL_MS,
  _resetForTests,
};
