"use strict";

const { spawn } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const { watchUrl } = require("./ids.js");

const ALLOWED_HEIGHTS = [480, 720, 1080];
const DEFAULT_HEIGHT = 1080;
/** Sem nenhuma linha do yt-dlp por este tempo, a conexão morreu de verdade. */
const STALL_MS = 120_000;

/** Erro com `kind` estável, para o renderer decidir entre avisar e cair no player do YouTube. */
class OnlineVideoError extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.name = "OnlineVideoError";
    this.kind = kind;
  }
}

function clampHeight(value) {
  const n = Number(value);
  return ALLOWED_HEIGHTS.includes(n) ? n : DEFAULT_HEIGHT;
}

/**
 * H.264 + AAC dentro de MP4: é o que o Chromium decodifica em hardware nos PCs
 * modestos das igrejas e o que o YouTube oferece até 1080p. As alternativas só
 * entram quando o vídeo não tem esse par (VP9/AV1 pesam na CPU, então ficam
 * por último). Nenhuma delas recomprime: o ffmpeg apenas junta as trilhas.
 */
function formatSelector(maxHeight) {
  const h = clampHeight(maxHeight);
  return [
    `bv*[height<=${h}][vcodec^=avc1]+ba[acodec^=mp4a]`,
    `b[height<=${h}][vcodec^=avc1][ext=mp4]`,
    `bv*[height<=${h}]+ba`,
    `b[height<=${h}]`,
  ].join("/");
}

function buildArgs({ id, outDir, ffmpegPath, maxHeight, cacheDir, jsRuntime }) {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--no-colors",
    "--no-warnings",
    "--newline",
    "--progress",
    "--socket-timeout",
    "20",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--no-mtime",
    "-f",
    formatSelector(maxHeight),
    "--merge-output-format",
    "mp4",
    "--ffmpeg-location",
    ffmpegPath,
    "--no-simulate",
    "--print",
    "before_dl:LJMETA %(height)s|%(width)s|%(vcodec)s|%(acodec)s|%(duration)s|%(ext)s",
    "--progress-template",
    "download:LJPROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.filename)s",
    "-o",
    path.join(outDir, "%(id)s.%(ext)s"),
  ];
  if (cacheDir) args.push("--cache-dir", cacheDir);
  if (jsRuntime) args.push("--js-runtimes", jsRuntime);
  args.push(watchUrl(id));
  return args;
}

function num(value) {
  if (value === undefined || value === "NA" || value === "None" || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Traduz uma linha da saída do yt-dlp; devolve null para o que não interessa. */
function parseLine(line) {
  if (line.startsWith("LJPROG|")) {
    const p = line.split("|");
    return {
      type: "progress",
      status: p[1],
      downloaded: num(p[2]),
      total: num(p[3]) ?? num(p[4]),
      speed: num(p[5]),
      eta: num(p[6]),
      file: p.slice(7).join("|"),
    };
  }
  if (line.startsWith("LJMETA ")) {
    const p = line.slice(7).split("|");
    return {
      type: "meta",
      height: num(p[0]),
      width: num(p[1]),
      vcodec: p[2] || null,
      acodec: p[3] || null,
      duration: num(p[4]),
      ext: p[5] || null,
    };
  }
  return null;
}

/**
 * O yt-dlp baixa vídeo e áudio em arquivos separados e depois os junta, então o
 * progresso de cada trilha recomeça do zero. O vídeo vem primeiro e concentra
 * ~95% dos bytes: mapeia-o para 0–92, o áudio para 92–98, e o merge fecha em 99.
 * A barra só sobe — nunca volta quando a segunda trilha começa.
 */
function createProgressMapper() {
  let streamIndex = -1;
  let lastFile = null;
  let best = 0;
  return function map(evt) {
    if (evt.file && evt.file !== lastFile) {
      lastFile = evt.file;
      streamIndex++;
    }
    const ratio = evt.total > 0 && evt.downloaded != null ? Math.min(1, evt.downloaded / evt.total) : 0;
    let pct;
    if (evt.status === "finished") pct = streamIndex === 0 ? 92 : 98;
    else if (streamIndex <= 0) pct = ratio * 92;
    else pct = 92 + ratio * 6;
    best = Math.max(best, Math.min(99, pct));
    return Math.round(best);
  };
}

/** Classifica o que o yt-dlp escreveu em stderr. A ordem importa: o mais específico primeiro. */
function classifyError(stderr) {
  const text = String(stderr || "");
  const rules = [
    ["age", /confirm your age|age[- ]restricted|inappropriate for some users/i],
    ["private", /private video|members-only|join this channel/i],
    ["geo", /available in your country|blocked it in your country|geo[- ]?restrict/i],
    ["live", /live event will begin|this live event|is a live stream|premieres in/i],
    ["bot", /not a bot|sign in to confirm/i],
    [
      "unavailable",
      /video (is )?(unavailable|not available)|has been removed|no longer available|account.*terminated|copyright|does not exist/i,
    ],
    ["disk", /no space left|ENOSPC|disk full/i],
    ["format", /requested format is not available|no video formats/i],
    ["forbidden", /HTTP Error 403|HTTP Error 429/i],
    [
      "network",
      /unable to download|getaddrinfo|name resolution|timed out|connection (reset|refused|aborted)|network is unreachable|SSL|certificate|ETIMEDOUT|ECONNRESET|ENOTFOUND|proxy/i,
    ],
  ];
  for (const [kind, re] of rules) {
    if (re.test(text)) return kind;
  }
  return "unknown";
}

/** Só estes tipos de falha se resolvem com um yt-dlp mais novo — o resto é do vídeo ou da rede. */
function needsFreshTool(kind) {
  return kind === "unknown" || kind === "forbidden" || kind === "format" || kind === "bot";
}

function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    // O yt-dlp standalone é um bootloader que gera o Python, e este gera o ffmpeg:
    // matar só o pai deixaria o download rodando escondido.
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      /* já saiu */
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* já saiu */
    }
  }
  const hard = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* já saiu */
    }
  }, 3000);
  hard.unref();
}

/**
 * Baixa um vídeo com o yt-dlp para `outDir/<id>.mp4`.
 *
 * @param {object} opts
 * @param {{ ytdlp: string, ffmpeg: string }} opts.tools
 * @param {string} opts.id
 * @param {string} opts.outDir
 * @param {number} [opts.maxHeight]
 * @param {string} [opts.cacheDir]
 * @param {string} [opts.jsRuntime]
 * @param {(p: { percent: number, downloaded: number|null, total: number|null, speed: number|null, eta: number|null }) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {typeof spawn} [opts.spawnImpl]
 * @param {typeof killTree} [opts.killImpl]
 * @param {number} [opts.stallMs]
 * @returns {Promise<{ file: string, size: number, meta: object|null }>}
 */
function run(opts) {
  const {
    tools,
    id,
    outDir,
    maxHeight,
    cacheDir,
    jsRuntime,
    onProgress,
    signal,
    spawnImpl = spawn,
    killImpl = killTree,
    stallMs = STALL_MS,
  } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OnlineVideoError("cancelled", "Download cancelado"));
      return;
    }
    fs.ensureDirSync(outDir);

    const args = buildArgs({ id, outDir, ffmpegPath: tools.ffmpeg, maxHeight, cacheDir, jsRuntime });
    const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
    // Só o runtime de JavaScript do yt-dlp pode rodar o Electron como Node; para o
    // resto, herdar a variável de um ambiente de desenvolvimento seria um acidente.
    if (jsRuntime && /^node:/.test(jsRuntime)) env.ELECTRON_RUN_AS_NODE = "1";
    else delete env.ELECTRON_RUN_AS_NODE;

    let child;
    try {
      child = spawnImpl(tools.ytdlp, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(new OnlineVideoError("tool", error.message));
      return;
    }

    const mapProgress = createProgressMapper();
    let meta = null;
    let stderr = "";
    let stdoutBuf = "";
    let settled = false;
    let stallTimer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn(value);
    };

    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        killImpl(child);
        finish(reject, new OnlineVideoError("network", "Sem resposta do YouTube"));
      }, stallMs);
    };

    const onAbort = () => {
      killImpl(child);
      finish(reject, new OnlineVideoError("cancelled", "Download cancelado"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    armStall();

    const handleLine = (raw) => {
      const line = raw.trim();
      if (!line) return;
      const evt = parseLine(line);
      if (!evt) return;
      if (evt.type === "meta") {
        meta = evt;
        return;
      }
      if (onProgress) {
        onProgress({
          percent: mapProgress(evt),
          downloaded: evt.downloaded,
          total: evt.total,
          speed: evt.speed,
          eta: evt.eta,
        });
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      armStall();
      stdoutBuf += chunk;
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        handleLine(stdoutBuf.slice(0, nl));
        stdoutBuf = stdoutBuf.slice(nl + 1);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      armStall();
      stderr = (stderr + chunk).slice(-8192);
    });

    child.on("error", (error) => {
      finish(reject, new OnlineVideoError("tool", error.message));
    });

    child.on("close", async (code) => {
      if (settled) return;
      if (stdoutBuf) handleLine(stdoutBuf);
      if (code !== 0) {
        const kind = classifyError(stderr);
        const detail = stderr.trim().split("\n").filter(Boolean).pop() || `código ${code}`;
        finish(reject, new OnlineVideoError(kind, detail));
        return;
      }
      const file = path.join(outDir, `${id}.mp4`);
      try {
        const st = await fs.stat(file);
        if (!st.isFile() || st.size === 0) throw new Error("vazio");
        finish(resolve, { file, size: st.size, meta });
      } catch {
        finish(reject, new OnlineVideoError("format", "O vídeo não saiu em MP4"));
      }
    });
  });
}

module.exports = {
  OnlineVideoError,
  ALLOWED_HEIGHTS,
  DEFAULT_HEIGHT,
  clampHeight,
  formatSelector,
  buildArgs,
  parseLine,
  createProgressMapper,
  classifyError,
  needsFreshTool,
  killTree,
  run,
};
