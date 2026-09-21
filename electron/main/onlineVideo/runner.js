"use strict";

const { spawn } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const { watchUrl } = require("./ids.js");

const ALLOWED_HEIGHTS = [480, 720, 1080];
const DEFAULT_HEIGHT = 1080;
/** Sem nenhuma linha do yt-dlp por este tempo, a conexão morreu de verdade. */
const STALL_MS = 120_000;
/** Descobrir as URLs diretas leva ~6 s; passar disso é conexão pendurada, não vídeo pesado. */
const RESOLVE_TIMEOUT_MS = 45_000;
/** A resposta do yt-dlp lista todos os formatos (~130 KB); acima disto algo está errado. */
const RESOLVE_MAX_OUTPUT = 8 * 1024 * 1024;
/** O YouTube serve os arquivos de vídeo só por estes hosts; qualquer outro não é reproduzido. */
const STREAM_HOST_RE = /^(?:[a-z0-9-]+\.)+googlevideo\.com$/i;

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
function formatSelector(maxHeight, { direct = false } = {}) {
  const h = clampHeight(maxHeight);
  // Tocar direto exige um arquivo servido por HTTP com `Range` (o <video> busca por
  // pedaços); trilhas em fragmentos ou HLS só o yt-dlp sabe juntar.
  const https = direct ? "[protocol=https]" : "";
  return [
    `bv*[height<=${h}][vcodec^=avc1]${https}+ba[acodec^=mp4a]${https}`,
    `b[height<=${h}][vcodec^=avc1][ext=mp4]${https}`,
    `bv*[height<=${h}]${https}+ba${https}`,
    `b[height<=${h}]${https}`,
  ].join("/");
}

/**
 * O yt-dlp só confia nos certificados do `certifi`. Proxy e antivírus que inspecionam o HTTPS
 * instalam a raiz deles apenas no repositório do sistema (o que o navegador lê), e o yt-dlp
 * passa a recusar toda conexão com "unable to get local issuer certificate".
 */
const CERT_ERROR_RE = /CERTIFICATE_VERIFY_FAILED|certificate verify failed|unable to get (?:local )?issuer certificate/i;
const SYSTEM_CERTS_ARGS = ["--compat-options", "no-certifi"];
/** Vale para o processo todo: depois que o repositório do sistema resolveu, as chamadas já começam com ele. */
const defaultCertTrust = { system: false };

function buildArgs({ id, outDir, ffmpegPath, maxHeight, cacheDir, jsRuntime, systemCerts }) {
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
  if (systemCerts) args.push(...SYSTEM_CERTS_ARGS);
  args.push(watchUrl(id));
  return args;
}

/** Só o runtime de JavaScript do yt-dlp pode rodar o Electron como Node; para o resto, herdar a variável de um ambiente de desenvolvimento seria um acidente. */
function childEnv(jsRuntime) {
  const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
  if (jsRuntime && /^node:/.test(jsRuntime)) env.ELECTRON_RUN_AS_NODE = "1";
  else delete env.ELECTRON_RUN_AS_NODE;
  return env;
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

/** Erro do que o yt-dlp escreveu em stderr; `certificate` marca a recusa do certificado da conexão. */
function ytdlpFailure(stderr, code) {
  const detail = stderr.trim().split("\n").filter(Boolean).pop() || `código ${code}`;
  const error = new OnlineVideoError(classifyError(stderr), detail);
  error.certificate = CERT_ERROR_RE.test(stderr);
  return error;
}

/**
 * Roda `attempt` e, se o yt-dlp recusou o certificado da conexão, repete uma vez confiando no
 * repositório do sistema. Só passa a preferi-lo se essa repetição der certo.
 *
 * @param {(opts: object) => Promise<any>} attempt
 * @param {{ certTrust?: { system: boolean } }} opts
 */
async function withSystemCerts(attempt, opts) {
  const trust = opts.certTrust || defaultCertTrust;
  try {
    return await attempt({ ...opts, systemCerts: trust.system });
  } catch (error) {
    if (trust.system || !error?.certificate) throw error;
    const result = await attempt({ ...opts, systemCerts: true });
    trust.system = true;
    console.info(
      "[onlineVideo] o yt-dlp não reconheceu o certificado da conexão; passou a usar os certificados do sistema"
    );
    return result;
  }
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
 * @param {boolean} [opts.systemCerts] confiar no repositório de certificados do sistema em vez do `certifi`
 * @returns {Promise<{ file: string, size: number, meta: object|null }>}
 */
function runOnce(opts) {
  const {
    tools,
    id,
    outDir,
    maxHeight,
    cacheDir,
    jsRuntime,
    systemCerts,
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

    const args = buildArgs({ id, outDir, ffmpegPath: tools.ffmpeg, maxHeight, cacheDir, jsRuntime, systemCerts });
    const env = childEnv(jsRuntime);

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
        finish(reject, ytdlpFailure(stderr, code));
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

/**
 * Como `runOnce`, mas se o yt-dlp recusar o certificado da conexão repete uma vez com o
 * repositório de certificados do sistema. `opts.certTrust` existe para os testes isolarem o estado.
 */
function run(opts) {
  return withSystemCerts(runOnce, opts);
}

function buildResolveArgs({ id, maxHeight, cacheDir, jsRuntime, systemCerts }) {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--no-colors",
    "--no-warnings",
    "--socket-timeout",
    "20",
    "--retries",
    "3",
    "-f",
    formatSelector(maxHeight, { direct: true }),
    "-J",
  ];
  if (cacheDir) args.push("--cache-dir", cacheDir);
  if (jsRuntime) args.push("--js-runtimes", jsRuntime);
  if (systemCerts) args.push(...SYSTEM_CERTS_ARGS);
  args.push(watchUrl(id));
  return args;
}

/** A URL só serve se for https, do YouTube e com `Range`; devolve-a ou null. */
function streamUrl(raw) {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && STREAM_HOST_RE.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Tamanho exato da trilha: o `clen` da URL é o do arquivo. `filesize_approx` é estimativa
 * e não serve para dimensionar um arquivo que vai ser preenchido por pedaços.
 */
function exactSize(url, format) {
  const clen = Number(new URL(url).searchParams.get("clen"));
  if (Number.isFinite(clen) && clen > 0) return clen;
  return Number.isFinite(format.filesize) && format.filesize > 0 ? format.filesize : null;
}

/** Quando a URL deixa de valer (parâmetro `expire`, em segundos); null se não vier. */
function expiryOf(url) {
  const n = Number(new URL(url).searchParams.get("expire"));
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

/**
 * Do JSON do yt-dlp para o que o renderer precisa: uma URL de vídeo e uma de áudio
 * (a mesma, quando o formato já vem com os dois). Nada aqui baixa: são links do
 * YouTube para o <video> ler direto.
 *
 * @param {object} info  saída de `yt-dlp -J -f <seletor>`
 * @param {number} [now]
 */
function parseStreams(info, now = Date.now()) {
  if (!info || typeof info !== "object") throw new OnlineVideoError("format", "Resposta do yt-dlp inválida");
  if (info.is_live === true) throw new OnlineVideoError("live", "Transmissão ao vivo");

  const formats = Array.isArray(info.requested_formats) && info.requested_formats.length ? info.requested_formats : [info];
  const usable = formats.filter((f) => f && streamUrl(f.url));
  const hasVideo = (f) => !!f.vcodec && f.vcodec !== "none";
  const hasAudio = (f) => !!f.acodec && f.acodec !== "none";

  const video = usable.find(hasVideo);
  if (!video) throw new OnlineVideoError("format", "Nenhum vídeo servido direto");
  const muxed = hasAudio(video);
  const audio = muxed ? video : usable.find((f) => hasAudio(f) && !hasVideo(f));
  if (!audio) throw new OnlineVideoError("format", "Nenhuma trilha de áudio servida direto");

  const expiries = [video, audio].map((f) => expiryOf(streamUrl(f.url))).filter((t) => t != null);
  return {
    video: {
      url: streamUrl(video.url),
      height: num(String(video.height)),
      width: num(String(video.width)),
      vcodec: video.vcodec || null,
      ext: video.ext || null,
      size: exactSize(streamUrl(video.url), video),
    },
    audio: {
      url: streamUrl(audio.url),
      acodec: audio.acodec || null,
      ext: audio.ext || null,
      size: exactSize(streamUrl(audio.url), audio),
    },
    muxed,
    duration: num(String(info.duration)),
    expiresAt: expiries.length ? Math.min(...expiries) : now + 30 * 60 * 1000,
  };
}

/**
 * Pergunta ao yt-dlp as URLs diretas do vídeo, sem baixar nada. Bem mais rápido que
 * baixar (~6 s), e sem player do YouTube no meio não há anúncio.
 *
 * @param {object} opts
 * @param {{ ytdlp: string }} opts.tools
 * @param {string} opts.id
 * @param {number} [opts.maxHeight]
 * @param {string} [opts.cacheDir]
 * @param {string} [opts.jsRuntime]
 * @param {AbortSignal} [opts.signal]
 * @param {typeof spawn} [opts.spawnImpl]
 * @param {typeof killTree} [opts.killImpl]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.systemCerts] confiar no repositório de certificados do sistema em vez do `certifi`
 */
function resolveStreamsOnce(opts) {
  const {
    tools,
    id,
    maxHeight,
    cacheDir,
    jsRuntime,
    systemCerts,
    signal,
    spawnImpl = spawn,
    killImpl = killTree,
    timeoutMs = RESOLVE_TIMEOUT_MS,
  } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OnlineVideoError("cancelled", "Cancelado"));
      return;
    }
    let child;
    try {
      child = spawnImpl(tools.ytdlp, buildResolveArgs({ id, maxHeight, cacheDir, jsRuntime, systemCerts }), {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv(jsRuntime),
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(new OnlineVideoError("tool", error.message));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      killImpl(child);
      finish(reject, new OnlineVideoError("cancelled", "Cancelado"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      killImpl(child);
      finish(reject, new OnlineVideoError("network", "Sem resposta do YouTube"));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > RESOLVE_MAX_OUTPUT) {
        killImpl(child);
        finish(reject, new OnlineVideoError("format", "Resposta do yt-dlp grande demais"));
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8192);
    });
    child.on("error", (error) => finish(reject, new OnlineVideoError("tool", error.message)));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(reject, ytdlpFailure(stderr, code));
        return;
      }
      try {
        finish(resolve, parseStreams(JSON.parse(stdout)));
      } catch (error) {
        finish(
          reject,
          error instanceof OnlineVideoError ? error : new OnlineVideoError("format", "Resposta do yt-dlp ilegível")
        );
      }
    });
  });
}

/** Como `resolveStreamsOnce`, com a mesma repetição por certificado recusado de `run`. */
function resolveStreams(opts) {
  return withSystemCerts(resolveStreamsOnce, opts);
}

/** Juntar duas trilhas sem recodificar leva poucos segundos; passar disso é ffmpeg pendurado. */
const MUX_TIMEOUT_MS = 180_000;

/**
 * Junta a trilha de vídeo e a de áudio num MP4, sem recodificar (só copia os pacotes) e
 * com o índice no começo, para o arquivo tocar e buscar como qualquer vídeo baixado.
 *
 * @param {object} opts
 * @param {string} opts.ffmpeg
 * @param {string} opts.video
 * @param {string} opts.audio
 * @param {string} opts.out
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ file: string, size: number }>}
 */
function muxCopy(opts) {
  const {
    ffmpeg,
    video,
    audio,
    out,
    signal,
    spawnImpl = spawn,
    killImpl = killTree,
    timeoutMs = MUX_TIMEOUT_MS,
  } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OnlineVideoError("cancelled", "Cancelado"));
      return;
    }
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      video,
      "-i",
      audio,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      out,
    ];
    let child;
    try {
      child = spawnImpl(ffmpeg, args, {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: childEnv(undefined),
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(new OnlineVideoError("tool", error.message));
      return;
    }

    let stderr = "";
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      killImpl(child);
      finish(reject, new OnlineVideoError("cancelled", "Cancelado"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      killImpl(child);
      finish(reject, new OnlineVideoError("tool", "O ffmpeg não terminou de juntar as trilhas"));
    }, timeoutMs);

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.on("error", (error) => finish(reject, new OnlineVideoError("tool", error.message)));
    child.on("close", async (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim().split("\n").filter(Boolean).pop() || `código ${code}`;
        finish(reject, new OnlineVideoError("format", `ffmpeg: ${detail}`));
        return;
      }
      try {
        const st = await fs.stat(out);
        if (!st.isFile() || st.size === 0) throw new Error("vazio");
        finish(resolve, { file: out, size: st.size });
      } catch {
        finish(reject, new OnlineVideoError("format", "O ffmpeg não gerou o MP4"));
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
  buildResolveArgs,
  streamUrl,
  parseStreams,
  resolveStreams,
  muxCopy,
  parseLine,
  createProgressMapper,
  classifyError,
  needsFreshTool,
  killTree,
  run,
};
