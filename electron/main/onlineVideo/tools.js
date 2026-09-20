"use strict";

const https = require("https");
const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");
const { Transform, pipeline } = require("stream");
const { execFile } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const { OnlineVideoError } = require("./runner.js");

/**
 * As duas ferramentas não vão dentro do instalador: o ffmpeg sozinho somaria
 * 60–90 MB por plataforma, e o yt-dlp precisa ser trocado toda vez que o
 * YouTube muda o player — o que acontece a cada poucas semanas. Elas são
 * baixadas no primeiro uso para `userData/bin`, e o yt-dlp pode ser renovado
 * sem lançar uma versão do app.
 */
const YTDLP_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

const YTDLP_ASSETS = {
  "darwin-arm64": "yt-dlp_macos",
  "darwin-x64": "yt-dlp_macos",
  "win32-x64": "yt-dlp.exe",
  "win32-arm64": "yt-dlp_arm64.exe",
  "win32-ia32": "yt-dlp_x86.exe",
  "linux-x64": "yt-dlp_linux",
  "linux-arm64": "yt-dlp_linux_aarch64",
};

/**
 * ffmpeg estático do projeto `ffmpeg-static` (o mesmo que o pacote npm usa),
 * fixado por versão e por SHA-256 do arquivo comprimido: ao contrário do
 * yt-dlp, ele quase não muda, então vale mais poder recusar um binário trocado.
 */
const FFMPEG_BASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";

const FFMPEG_WIN_X64 = {
  name: "ffmpeg-win32-x64.gz",
  sha256: "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77",
};

const FFMPEG_ASSETS = {
  "darwin-arm64": {
    name: "ffmpeg-darwin-arm64.gz",
    sha256: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
  },
  "darwin-x64": {
    name: "ffmpeg-darwin-x64.gz",
    sha256: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
  },
  "linux-arm64": {
    name: "ffmpeg-linux-arm64.gz",
    sha256: "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0",
  },
  "linux-x64": {
    name: "ffmpeg-linux-x64.gz",
    sha256: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
  },
  "win32-x64": FFMPEG_WIN_X64,
  // Windows ARM64 executa o binário x64 por emulação.
  "win32-arm64": FFMPEG_WIN_X64,
};

const USER_AGENT = "LouvorJA-Violin";

function toolError(message) {
  return new OnlineVideoError("tool", message);
}

function networkError(message) {
  return new OnlineVideoError("network", message);
}

/** GET com redirecionamento (o GitHub responde 302 para outro host). */
function request(url, { signal, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OnlineVideoError("cancelled", "Cancelado"));
      return;
    }
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(toolError(`URL inválida: ${url}`));
      return;
    }
    const lib = target.protocol === "http:" ? http : https;
    const req = lib.get(target, { headers: { "User-Agent": USER_AGENT } }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (maxRedirects <= 0) {
          reject(networkError("Redirecionamentos demais"));
          return;
        }
        request(new URL(res.headers.location, target).toString(), {
          signal,
          maxRedirects: maxRedirects - 1,
        }).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(networkError(`HTTP ${status} em ${target.host}`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(30_000, () => req.destroy(new Error("tempo esgotado")));
    req.on("error", (e) => reject(e instanceof OnlineVideoError ? e : networkError(e.message)));
    if (signal) {
      signal.addEventListener("abort", () => req.destroy(new OnlineVideoError("cancelled", "Cancelado")), {
        once: true,
      });
    }
  });
}

async function fetchText(url, opts) {
  const res = await request(url, opts);
  let body = "";
  res.setEncoding("utf8");
  for await (const chunk of res) body += chunk;
  return body;
}

/**
 * Baixa `url` para `dest`, conferindo o SHA-256 dos bytes recebidos.
 * Grava num `.download` e só renomeia no fim: `dest` nunca fica pela metade.
 */
async function downloadTo(url, dest, { expectedSha256, gunzip = false, onProgress, signal } = {}) {
  const res = await request(url, { signal });
  const total = Number(res.headers["content-length"]) || null;
  const hash = crypto.createHash("sha256");
  let received = 0;

  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      received += chunk.length;
      if (onProgress) onProgress({ received, total });
      cb(null, chunk);
    },
  });

  const tmp = `${dest}.download`;
  await fs.ensureDir(path.dirname(dest));
  const streams = [res, tap];
  if (gunzip) streams.push(zlib.createGunzip());
  streams.push(fs.createWriteStream(tmp, { mode: 0o755 }));

  try {
    await new Promise((resolve, reject) => {
      pipeline(...streams, (err) => (err ? reject(err) : resolve()));
    });
  } catch (error) {
    await fs.remove(tmp);
    if (error instanceof OnlineVideoError) throw error;
    throw networkError(error.message);
  }

  const sha256 = hash.digest("hex");
  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    await fs.remove(tmp);
    throw toolError(`SHA-256 não confere para ${path.basename(dest)}`);
  }
  return { tmp, sha256, bytes: received };
}

function parseSums(text, assetName) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m && m[2] === assetName) return m[1].toLowerCase();
  }
  return null;
}

function run(bin, args, { timeout = 15_000, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(bin, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(toolError(`${path.basename(bin)} não executa: ${err.message}`));
      else resolve(`${stdout}${stderr}`);
    });
  });
}

/**
 * @param {object} cfg
 * @param {string} cfg.binDir
 */
function createTools(cfg) {
  const {
    binDir,
    platform = process.platform,
    arch = process.arch,
    ytdlpBase = YTDLP_BASE,
    ffmpegBase = FFMPEG_BASE,
    ytdlpAssets = YTDLP_ASSETS,
    ffmpegAssets = FFMPEG_ASSETS,
    execFileImpl = execFile,
  } = cfg;

  const key = `${platform}-${arch}`;
  const exe = platform === "win32" ? ".exe" : "";
  const ytdlpPath = path.join(binDir, `yt-dlp${exe}`);
  const ffmpegPath = path.join(binDir, `ffmpeg${exe}`);
  const metaPath = path.join(binDir, "tools.json");
  const supported = Boolean(ytdlpAssets[key] && ffmpegAssets[key]);

  let _ensuring = null;
  const _listeners = new Set();
  /** Último andamento publicado pela instalação em curso: quem chega no meio parte dele, não de zero. */
  let _last = null;

  async function readMeta() {
    try {
      return await fs.readJson(metaPath);
    } catch {
      return {};
    }
  }

  async function writeMeta(patch) {
    const current = await readMeta();
    await fs.writeJson(metaPath, { ...current, ...patch }, { spaces: 2 });
  }

  async function installYtdlp({ onProgress, signal }) {
    const asset = ytdlpAssets[key];
    const sums = await fetchText(`${ytdlpBase}/SHA2-256SUMS`, { signal });
    const expected = parseSums(sums, asset);
    if (!expected) throw toolError(`Sem checksum publicado para ${asset}`);

    const { tmp, sha256 } = await downloadTo(`${ytdlpBase}/${asset}`, ytdlpPath, {
      expectedSha256: expected,
      signal,
      onProgress: (p) => onProgress?.({ tool: "yt-dlp", ...p }),
    });
    try {
      await fs.chmod(tmp, 0o755);
      const out = await run(tmp, ["--version"], { execFileImpl });
      const version = out.trim().split(/\s+/)[0];
      if (!/^\d{4}\.\d{2}\.\d{2}/.test(version)) throw toolError(`Versão inesperada do yt-dlp: ${version}`);
      await fs.move(tmp, ytdlpPath, { overwrite: true });
      await writeMeta({ ytdlp: { version, sha256, installedAt: Date.now() } });
      return version;
    } catch (error) {
      await fs.remove(tmp);
      throw error;
    }
  }

  async function installFfmpeg({ onProgress, signal }) {
    const asset = ffmpegAssets[key];
    const { tmp, sha256 } = await downloadTo(`${ffmpegBase}/${asset.name}`, ffmpegPath, {
      expectedSha256: asset.sha256,
      gunzip: true,
      signal,
      onProgress: (p) => onProgress?.({ tool: "ffmpeg", ...p }),
    });
    try {
      await fs.chmod(tmp, 0o755);
      const out = await run(tmp, ["-version"], { execFileImpl });
      if (!/ffmpeg version/i.test(out)) throw toolError("O ffmpeg baixado não respondeu como esperado");
      await fs.move(tmp, ffmpegPath, { overwrite: true });
      await writeMeta({ ffmpeg: { sha256, installedAt: Date.now() } });
    } catch (error) {
      await fs.remove(tmp);
      throw error;
    }
  }

  function paths() {
    return { ytdlp: ytdlpPath, ffmpeg: ffmpegPath };
  }

  function ready() {
    return fs.pathExistsSync(ytdlpPath) && fs.pathExistsSync(ffmpegPath);
  }

  /** Espera `promise`, mas desiste (sem interrompê-la) se `signal` for abortado. */
  function abortable(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new OnlineVideoError("cancelled", "Cancelado"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  /**
   * Garante as duas ferramentas.
   *
   * A instalação é de todos, não de quem pediu primeiro: chamadas simultâneas
   * compartilham o mesmo trabalho e todas recebem o andamento. Cancelar só faz quem
   * cancelou parar de esperar — a instalação segue, porque o próximo pedido (o
   * operador trocou de vídeo) a aproveita em vez de recomeçar do zero.
   */
  function ensure({ onProgress, signal } = {}) {
    if (!supported) {
      return Promise.reject(new OnlineVideoError("unsupported", `Plataforma sem suporte: ${key}`));
    }
    if (signal?.aborted) return Promise.reject(new OnlineVideoError("cancelled", "Cancelado"));
    if (onProgress) {
      _listeners.add(onProgress);
      if (_ensuring && _last) {
        const snapshot = _last;
        queueMicrotask(() => onProgress(snapshot));
      }
    }
    if (!_ensuring) {
      _ensuring = (async () => {
        try {
          await fs.ensureDir(binDir);
          const notify = (p) => {
            _last = p;
            for (const listener of _listeners) {
              try {
                listener(p);
              } catch {
                /* ouvinte que já foi embora não derruba a instalação */
              }
            }
          };
          if (!fs.pathExistsSync(ytdlpPath)) await installYtdlp({ onProgress: notify });
          if (!fs.pathExistsSync(ffmpegPath)) await installFfmpeg({ onProgress: notify });
          return paths();
        } finally {
          _ensuring = null;
          _last = null;
          _listeners.clear();
        }
      })();
      // Se todos que esperavam já desistiram, a falha não pode virar rejeição sem dono.
      _ensuring.catch(() => {});
    }
    return abortable(_ensuring, signal);
  }

  /** Reinstala o yt-dlp mais novo. Só chamar sem nenhum download em andamento (no Windows o .exe em uso não é sobrescrito). */
  async function refreshYtdlp({ onProgress, signal } = {}) {
    if (!supported) throw new OnlineVideoError("unsupported", `Plataforma sem suporte: ${key}`);
    await fs.ensureDir(binDir);
    return installYtdlp({ onProgress, signal });
  }

  /**
   * Os dois binários instalados ainda executam? Barato (dois `--version`), e é o
   * que separa "o yt-dlp está velho" de "um binário foi corrompido ou barrado":
   * um ffmpeg quebrado não faz o yt-dlp falhar ao subir, só ao juntar as trilhas,
   * e o erro chega igual ao de um yt-dlp desatualizado.
   */
  async function ffmpegWorks() {
    try {
      const out = await run(ffmpegPath, ["-version"], { execFileImpl });
      return /ffmpeg version/i.test(out);
    } catch {
      return false;
    }
  }

  async function works() {
    try {
      const yt = await run(ytdlpPath, ["--version"], { execFileImpl });
      if (!/^\d{4}\.\d{2}\.\d{2}/.test(yt.trim())) return false;
    } catch {
      return false;
    }
    return ffmpegWorks();
  }

  /** Descarta os binários para o próximo `ensure` recomeçar do zero (arquivo corrompido, arquitetura errada). */
  async function reset() {
    await fs.remove(ytdlpPath);
    await fs.remove(ffmpegPath);
    await fs.remove(metaPath);
  }

  async function info() {
    const meta = await readMeta();
    return {
      supported,
      ready: ready(),
      ytdlpVersion: meta.ytdlp?.version ?? null,
      ytdlpInstalledAt: meta.ytdlp?.installedAt ?? null,
    };
  }

  return { key, supported, paths, ready, ensure, refreshYtdlp, works, ffmpegWorks, reset, info };
}

module.exports = {
  createTools,
  parseSums,
  downloadTo,
  fetchText,
  YTDLP_ASSETS,
  FFMPEG_ASSETS,
  YTDLP_BASE,
  FFMPEG_BASE,
};
