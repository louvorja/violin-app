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
const { extractZip } = require("./unzip.js");

/**
 * As ferramentas não vão dentro do instalador: o ffmpeg sozinho somaria
 * 60–90 MB por plataforma, o yt-dlp.exe é barrado por alguns antivírus (o que
 * barraria o instalador inteiro), e o yt-dlp precisa ser trocado toda vez que o
 * YouTube muda o player. Elas são baixadas para `userData/bin` em segundo plano
 * e o yt-dlp se renova sozinho, sem lançar uma versão do app.
 *
 * Canal nightly: é o que o próprio yt-dlp recomenda, e onde as correções do
 * YouTube saem primeiro — o estável chegou a ficar dois meses parado em 2026.
 */
const YTDLP_BASE = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download";

/**
 * `zip` é a versão em pasta (PyInstaller onedir), a preferida: o arquivo único se
 * descompacta numa pasta temporária a cada execução — 3,5 s medidos no macOS só
 * para responder `--version`, contra 0,35 s da pasta. `file` é a reserva, se a
 * pasta não puder ser instalada.
 */
const YTDLP_ASSETS = {
  "darwin-arm64": { zip: "yt-dlp_macos.zip", exe: "yt-dlp_macos", file: "yt-dlp_macos" },
  "darwin-x64": { zip: "yt-dlp_macos.zip", exe: "yt-dlp_macos", file: "yt-dlp_macos" },
  "win32-x64": { zip: "yt-dlp_win.zip", exe: "yt-dlp.exe", file: "yt-dlp.exe" },
  "win32-arm64": { zip: "yt-dlp_win_arm64.zip", exe: "yt-dlp_arm64.exe", file: "yt-dlp_arm64.exe" },
  "win32-ia32": { zip: "yt-dlp_win_x86.zip", exe: "yt-dlp_x86.exe", file: "yt-dlp_x86.exe" },
  "linux-x64": { zip: "yt-dlp_linux.zip", exe: "yt-dlp_linux", file: "yt-dlp_linux" },
  "linux-arm64": { zip: "yt-dlp_linux_aarch64.zip", exe: "yt-dlp_linux_aarch64", file: "yt-dlp_linux_aarch64" },
};

/** A primeira execução de uma pasta nova espera o antivírus examinar cada arquivo (6 s no macOS). */
const FIRST_RUN_TIMEOUT_MS = 120_000;
/** Checar se há yt-dlp novo custa ~1,5 KB; baixar custa 24–54 MB. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Uma versão com menos que isso não é trocada pela checagem periódica, só por uma falha. */
const UPDATE_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Quem não usa vídeo on-line há este tempo não paga atualizações; reabrir o módulo retoma. */
const DORMANT_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** Pré-instalação que falhou (sem rede, antivírus) não se repete a cada abertura. */
const PREINSTALL_RETRY_MS = 24 * 60 * 60 * 1000;
const USAGE_WRITE_INTERVAL_MS = 60 * 60 * 1000;

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

/**
 * PO Token provider (Rust) + plugin do yt-dlp. O YouTube exige um token por
 * vídeo para liberar formatos altos; sem ele, os links do CDN respondem 403.
 * Versão fixa e SHA-256 dos assets do release; atualização junto do yt-dlp.
 */
const POT_VERSION = "0.8.1";
const POT_BASE = `https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/v${POT_VERSION}`;
const POT_PLUGIN = {
  name: "bgutil-ytdlp-pot-provider-rs.zip",
  sha256: "99fd83b98fa93b193d6a3b69dc74410d76e7a2b889868c54d16121cac9060344",
};
const POT_ASSETS = {
  "darwin-arm64": {
    name: "bgutil-pot-macos-aarch64",
    sha256: "34b83baf0a557fecaa6d67a8177e53e169c2ccf987182883a4bae289a7176883",
  },
  "darwin-x64": {
    name: "bgutil-pot-macos-x86_64",
    sha256: "0391175fa938c7fabbb8b40a40bd43182ef75af97e1dd3fab56eb23b4ac3e113",
  },
  "win32-x64": {
    name: "bgutil-pot-windows-x86_64.exe",
    sha256: "25d6b05c79176aa792454c3d1727922ca47e56cf11cb1e866615d751819b14a0",
  },
  // Windows ARM64 roda o binário x64 por emulação.
  "win32-arm64": {
    name: "bgutil-pot-windows-x86_64.exe",
    sha256: "25d6b05c79176aa792454c3d1727922ca47e56cf11cb1e866615d751819b14a0",
  },
  "linux-x64": {
    name: "bgutil-pot-linux-x86_64",
    sha256: "e7c264a574fa2705b6e5dc62283a8a4e80130f27b9d7e9df44e6b09aa6151a87",
  },
  "linux-arm64": {
    name: "bgutil-pot-linux-aarch64",
    sha256: "4f4a1f681dba45e695e1c14d314517da180a1fd374afd09d634fd80ef6d0284b",
  },
};

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

const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}/;

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
    potBase = POT_BASE,
    potAssets = POT_ASSETS,
    potPlugin = POT_PLUGIN,
    execFileImpl = execFile,
    now = Date.now,
  } = cfg;

  const key = `${platform}-${arch}`;
  const exe = platform === "win32" ? ".exe" : "";
  /** Cada versão do yt-dlp numa pasta própria (`<sha256[0:16]>`): trocar nunca mexe na que está rodando. */
  const ytdlpRoot = path.join(binDir, "ytdlp");
  /** O arquivo único que as versões anteriores do app instalavam; vale até a primeira troca. */
  const legacyYtdlpPath = path.join(binDir, `yt-dlp${exe}`);
  const ffmpegPath = path.join(binDir, `ffmpeg${exe}`);
  const metaPath = path.join(binDir, "tools.json");
  const supported = Boolean(ytdlpAssets[key] && ffmpegAssets[key]);
  const potPath = path.join(binDir, `bgutil-pot${exe}`);
  const potPluginDir = path.join(binDir, "yt-dlp-plugins");
  const potPluginRoot = path.join(potPluginDir, "bgutil-ytdlp-pot-provider");
  const potCacheDir = path.join(binDir, "pot-cache");
  const potAsset = potAssets[key];
  const potSupported = Boolean(potAsset);

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

  /** `tools.json` diz qual pasta do yt-dlp vale: gravação atômica e uma de cada vez. */
  let _metaQueue = Promise.resolve();
  function updateMeta(mutate) {
    const task = _metaQueue.then(async () => {
      const next = mutate(await readMeta());
      await fs.ensureDir(binDir);
      const tmp = `${metaPath}.tmp`;
      await fs.writeJson(tmp, next, { spaces: 2 });
      await fs.rename(tmp, metaPath);
      return next;
    });
    _metaQueue = task.catch(() => {});
    return task;
  }

  function writeMeta(patch) {
    return updateMeta((current) => ({ ...current, ...patch }));
  }

  function loadCurrentSync() {
    try {
      const y = fs.readJsonSync(metaPath)?.ytdlp;
      if (y && /^[0-9a-f]{16}$/.test(y.dir) && typeof y.exe === "string" && path.basename(y.exe) === y.exe) {
        return { dir: y.dir, exe: y.exe };
      }
    } catch {
      /* sem metadados: vale o arquivo único antigo, se existir */
    }
    return null;
  }

  let _current = loadCurrentSync();

  function currentYtdlpPath() {
    if (!_current) return null;
    const file = path.join(ytdlpRoot, _current.dir, _current.exe);
    return fs.pathExistsSync(file) ? file : null;
  }

  function ytdlpPath() {
    return currentYtdlpPath() || legacyYtdlpPath;
  }

  /** Instalar, trocar e limpar versões do yt-dlp nunca correm ao mesmo tempo. */
  let _ytdlpLock = Promise.resolve();
  function exclusive(task) {
    const result = _ytdlpLock.then(task, task);
    _ytdlpLock = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  async function probeYtdlp(file) {
    const out = await run(file, ["--version"], { execFileImpl, timeout: FIRST_RUN_TIMEOUT_MS });
    const version = out.trim().split(/\s+/)[0];
    if (!VERSION_RE.test(version)) throw toolError(`Versão inesperada do yt-dlp: ${version}`);
    return version;
  }

  /** Baixa uma versão para a pasta dela e confere que executa. Não a torna a atual. */
  async function installVersion(assetName, sha256, { zip, exeName, onProgress, signal }) {
    const dir = sha256.slice(0, 16);
    const target = path.join(ytdlpRoot, dir);
    const file = path.join(target, exeName);
    // Mesmo SHA-256 da que está em uso: nada a baixar.
    if (_current?.dir === dir && _current.exe === exeName && fs.pathExistsSync(file)) {
      const meta = await readMeta();
      return { dir, exe: exeName, asset: assetName, sha256, version: meta.ytdlp?.version ?? (await probeYtdlp(file)) };
    }
    // Resto de uma tentativa anterior: nunca é a pasta em uso, que tem outro SHA-256.
    await fs.remove(target);
    await fs.ensureDir(ytdlpRoot);
    const progress = (p) => onProgress?.({ tool: "yt-dlp", ...p });
    try {
      if (zip) {
        const { tmp } = await downloadTo(`${ytdlpBase}/${assetName}`, path.join(ytdlpRoot, `${dir}.zip`), {
          expectedSha256: sha256,
          signal,
          onProgress: progress,
        });
        try {
          await extractZip(tmp, target, { signal });
        } catch (error) {
          if (signal?.aborted) throw new OnlineVideoError("cancelled", "Cancelado");
          throw toolError(`O zip do yt-dlp não abriu: ${error.message}`);
        } finally {
          await fs.remove(tmp).catch(() => {});
        }
        if (!(await fs.pathExists(file))) throw toolError(`O zip do yt-dlp não traz ${exeName}`);
        await fs.chmod(file, 0o755);
        return { dir, exe: exeName, asset: assetName, sha256, version: await probeYtdlp(file) };
      }
      const { tmp } = await downloadTo(`${ytdlpBase}/${assetName}`, file, {
        expectedSha256: sha256,
        signal,
        onProgress: progress,
      });
      await fs.chmod(tmp, 0o755);
      const version = await probeYtdlp(tmp);
      await fs.move(tmp, file, { overwrite: true });
      return { dir, exe: exeName, asset: assetName, sha256, version };
    } catch (error) {
      await fs.remove(target).catch(() => {});
      throw error;
    }
  }

  /**
   * Instala o yt-dlp mais novo do canal numa pasta nova e só então o torna o atual. A
   * versão anterior continua no disco, intacta, para o que ainda a estiver executando;
   * `cleanup` a apaga na próxima abertura. Com `onlyIfChanged`, não baixa nada se o
   * SHA-256 publicado for o da versão instalada.
   */
  function installYtdlp({ onProgress, signal, onlyIfChanged = false } = {}) {
    return exclusive(async () => {
      const asset = ytdlpAssets[key];
      const sums = await fetchText(`${ytdlpBase}/SHA2-256SUMS`, { signal });
      const installed = (await readMeta()).ytdlp;
      if (
        onlyIfChanged &&
        installed?.asset &&
        currentYtdlpPath() &&
        parseSums(sums, installed.asset) === installed.sha256
      ) {
        return { version: installed.version, updated: false };
      }

      let result = null;
      let zipError = null;
      const zipSha = parseSums(sums, asset.zip);
      if (zipSha) {
        try {
          result = await installVersion(asset.zip, zipSha, { zip: true, exeName: asset.exe, onProgress, signal });
        } catch (error) {
          if (error?.kind !== "tool" || !asset.file) throw error;
          zipError = error;
          console.warn("[onlineVideo] yt-dlp em pasta indisponível, usando o arquivo único:", error.message);
        }
      }
      if (!result) {
        const fileSha = asset.file ? parseSums(sums, asset.file) : null;
        if (!fileSha) throw zipError || toolError(`Sem checksum publicado para ${asset.zip}`);
        result = await installVersion(asset.file, fileSha, {
          zip: false,
          exeName: `yt-dlp${exe}`,
          onProgress,
          signal,
        });
      }

      const at = now();
      await updateMeta((meta) => ({
        ...meta,
        ytdlp: {
          version: result.version,
          sha256: result.sha256,
          asset: result.asset,
          dir: result.dir,
          exe: result.exe,
          installedAt: at,
          checkedAt: at,
          lastUsedAt: meta.ytdlp?.lastUsedAt ?? null,
        },
      }));
      _current = { dir: result.dir, exe: result.exe };
      return { version: result.version, updated: true };
    });
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

  async function installPot({ onProgress, signal } = {}) {
    if (!potSupported) {
      throw new OnlineVideoError("unsupported", `Provedor de PO token sem suporte: ${key}`);
    }
    const JSZip = require("jszip");
    // O zip do plugin tem poucos KB: não vale reiniciar a barra da ferramenta.
    const pluginZip = await downloadTo(`${potBase}/${potPlugin.name}`, `${potPluginRoot}.zip`, {
      expectedSha256: potPlugin.sha256,
      signal,
    });
    try {
      const zip = await JSZip.loadAsync(await fs.readFile(pluginZip.tmp));
      await fs.remove(potPluginRoot);
      const root = path.resolve(potPluginRoot);
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const clean = path.posix.normalize(name);
        if (!clean || clean.startsWith("../") || path.posix.isAbsolute(clean)) {
          throw toolError("O zip do provedor de PO token tem caminho inválido");
        }
        const dest = path.resolve(root, clean);
        if (dest !== root && !dest.startsWith(root + path.sep)) {
          throw toolError("O zip do provedor de PO token sai da pasta do plugin");
        }
        await fs.ensureDir(path.dirname(dest));
        await fs.writeFile(dest, await entry.async("nodebuffer"));
      }
    } finally {
      await fs.remove(`${potPluginRoot}.zip`).catch(() => {});
      await fs.remove(pluginZip.tmp).catch(() => {});
    }

    const { tmp, sha256 } = await downloadTo(`${potBase}/${potAsset.name}`, potPath, {
      expectedSha256: potAsset.sha256,
      signal,
      onProgress: (p) => onProgress?.({ tool: "pot", ...p }),
    });
    try {
      await fs.chmod(tmp, 0o755);
      const out = await run(tmp, ["--version"], { execFileImpl });
      if (!/bgutil-pot/i.test(out)) throw toolError("O provedor de PO token não respondeu como esperado");
      await fs.move(tmp, potPath, { overwrite: true });
      await writeMeta({ pot: { version: POT_VERSION, sha256, installedAt: Date.now() } });
    } catch (error) {
      await fs.remove(tmp);
      throw error;
    }
  }

  function paths() {
    const pot = potReady() ? potPath : null;
    return {
      ytdlp: ytdlpPath(),
      ffmpeg: ffmpegPath,
      pot,
      pluginDir: pot ? potPluginDir : null,
      potCacheDir,
    };
  }

  function ready() {
    return fs.pathExistsSync(ytdlpPath()) && fs.pathExistsSync(ffmpegPath);
  }

  function potReady() {
    return (
      potSupported &&
      fs.pathExistsSync(potPath) &&
      fs.pathExistsSync(path.join(potPluginRoot, "yt_dlp_plugins"))
    );
  }

  function needsPot() {
    return potSupported && !potReady();
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
          if (!fs.pathExistsSync(ytdlpPath())) await installYtdlp({ onProgress: notify });
          if (!fs.pathExistsSync(ffmpegPath)) await installFfmpeg({ onProgress: notify });
          if (needsPot()) {
            try {
              // Provedor é opcional: sem ele o yt-dlp/ffmpeg continuam válidos e
              // o app cai no player do YouTube quando o CDN exigir o token.
              await installPot({ onProgress: notify, signal });
            } catch (error) {
              if (!signal?.aborted) {
                console.warn(
                  "[onlineVideo] provedor de PO token indisponível:",
                  error?.message || error
                );
              }
            }
          }
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

  /**
   * Troca pelo yt-dlp mais novo, se houver um: sem release nova, custa só a lista de
   * SHA-256 (~1,5 KB). A versão nova vai para outra pasta, então o que ainda roda a
   * anterior não é afetado. Devolve a versão em uso depois da troca.
   */
  async function refreshYtdlp({ onProgress, signal } = {}) {
    if (!supported) throw new OnlineVideoError("unsupported", `Plataforma sem suporte: ${key}`);
    const { version } = await installYtdlp({ onProgress, signal, onlyIfChanged: true });
    return version;
  }

  /**
   * Apaga as versões do yt-dlp que não são a atual e o arquivo único antigo. Só no
   * início do app, antes de qualquer yt-dlp deste processo rodar: uma versão trocada
   * durante a sessão pode estar executando até o fim dela. No Windows, um .exe que
   * ainda roda (app anterior travado) fica para a próxima vez.
   */
  function cleanup() {
    return exclusive(async () => {
      const keep = currentYtdlpPath() ? _current.dir : null;
      let entries = [];
      try {
        entries = await fs.readdir(ytdlpRoot);
      } catch {
        /* nada instalado em pasta ainda */
      }
      for (const name of entries) {
        if (name !== keep) await fs.remove(path.join(ytdlpRoot, name)).catch(() => {});
      }
      if (keep) {
        await fs.remove(legacyYtdlpPath).catch(() => {});
        await fs.remove(`${legacyYtdlpPath}.download`).catch(() => {});
      }
    });
  }

  let _usageWrittenAt = -Infinity;
  /** Anota que o yt-dlp foi usado (no máximo uma gravação por hora): quem parou de usar deixa de pagar atualizações. */
  function markUsed() {
    const at = now();
    if (at - _usageWrittenAt < USAGE_WRITE_INTERVAL_MS) return;
    _usageWrittenAt = at;
    void updateMeta((meta) => (meta.ytdlp ? { ...meta, ytdlp: { ...meta.ytdlp, lastUsedAt: at } } : meta)).catch(
      () => {}
    );
  }

  /**
   * A checagem periódica: no máximo uma por dia, só para quem usou vídeo on-line no
   * último mês e só quando a versão instalada já tem uma semana — falhas que uma
   * versão nova resolve não esperam isso, renovam na hora (`refreshYtdlp`). O arquivo
   * único das versões anteriores do app migra para a pasta na primeira oportunidade.
   */
  async function checkForUpdate({ ignoreDormancy = false, signal } = {}) {
    if (!supported) return { action: "unsupported" };
    if (!ready()) return { action: "missing" };
    const y = (await readMeta()).ytdlp || {};
    const at = now();
    const migrating = !y.asset || !currentYtdlpPath();
    if (!migrating) {
      if (!ignoreDormancy && at - (y.lastUsedAt ?? y.installedAt ?? 0) > DORMANT_AFTER_MS) return { action: "dormant" };
      if (at - (y.installedAt ?? 0) < UPDATE_MIN_AGE_MS) return { action: "fresh" };
    }
    if (at - (y.checkedAt ?? 0) < UPDATE_CHECK_INTERVAL_MS) return { action: "checked" };
    // Anotada antes de tentar: uma checagem que falha (sem rede, antivírus) não se repete no mesmo dia.
    await updateMeta((meta) => ({ ...meta, ytdlp: { ...meta.ytdlp, checkedAt: at } }));
    const { version, updated } = await installYtdlp({ signal, onlyIfChanged: true });
    return { action: updated ? "updated" : "current", version };
  }

  /**
   * Instala tudo antes do primeiro vídeo, em segundo plano. Uma tentativa que falhou
   * (inclusive o provedor de PO token, que `ensure` tolera) só se repete no dia seguinte.
   */
  async function preinstall() {
    if (!supported) return { action: "unsupported" };
    if (ready() && !needsPot()) return { action: "ready" };
    const meta = await readMeta();
    if (meta.preinstallFailedAt && now() - meta.preinstallFailedAt < PREINSTALL_RETRY_MS) {
      return { action: "backoff" };
    }
    try {
      await ensure();
    } catch (error) {
      await writeMeta({ preinstallFailedAt: now() }).catch(() => {});
      throw error;
    }
    if (needsPot()) {
      await writeMeta({ preinstallFailedAt: now() }).catch(() => {});
      return { action: "partial" };
    }
    return { action: "installed" };
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
      const yt = await run(ytdlpPath(), ["--version"], { execFileImpl });
      if (!VERSION_RE.test(yt.trim())) return false;
    } catch {
      return false;
    }
    return ffmpegWorks();
  }

  /** Descarta os binários para o próximo `ensure` recomeçar do zero (arquivo corrompido, arquitetura errada). */
  async function reset() {
    await exclusive(async () => {
      _current = null;
      await fs.remove(ytdlpRoot);
      await fs.remove(legacyYtdlpPath);
    });
    await fs.remove(ffmpegPath);
    await fs.remove(potPath);
    await fs.remove(`${potPath}.download`);
    await fs.remove(potPluginRoot);
    await fs.remove(`${potPluginRoot}.zip`);
    await fs.remove(`${potPluginRoot}.zip.download`);
    await fs.remove(potCacheDir);
    await fs.remove(metaPath);
  }

  async function info() {
    const meta = await readMeta();
    return {
      supported,
      ready: ready(),
      potReady: potReady(),
      potSupported,
      ytdlpVersion: meta.ytdlp?.version ?? null,
      ytdlpInstalledAt: meta.ytdlp?.installedAt ?? null,
      potVersion: meta.pot?.version ?? null,
    };
  }

  /** Aguarda uma instalação em curso sem iniciar outra, antes de mover `bin/`. */
  async function waitForIdle() {
    await _ensuring?.catch(() => {});
    await _ytdlpLock;
  }

  return {
    key,
    supported,
    paths,
    ready,
    potReady,
    potSupported,
    needsPot,
    ensure,
    refreshYtdlp,
    cleanup,
    markUsed,
    checkForUpdate,
    preinstall,
    works,
    ffmpegWorks,
    reset,
    info,
    waitForIdle,
  };
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
  POT_ASSETS,
  POT_PLUGIN,
  POT_VERSION,
  POT_BASE,
};
