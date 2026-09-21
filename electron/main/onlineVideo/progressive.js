"use strict";

/**
 * Baixa as trilhas de um vídeo do YouTube UMA vez, aos pedaços, para arquivos que vão
 * crescendo — e deixa qualquer janela tocar deles enquanto isso, por `Range`.
 *
 * Por quê: cada janela que abrisse o link do YouTube direto abriria a própria conexão
 * (projeção, retorno, operador e o player do app: 3 a 4 cópias), e o YouTube limita
 * cada conexão aberta a ~2× o tempo real — as imagens travavam. Pedaços de alguns MB
 * chegam a 10 MB/s, muito à frente do que se assiste; então quem baixa é um só, o
 * main, e as janelas leem do disco, sem rede e sem disputar nada.
 */

const https = require("https");
const fs = require("fs-extra");
const path = require("path");
const { Readable } = require("stream");
const { OnlineVideoError, streamUrl } = require("./runner.js");
const { RangeSet } = require("./rangeSet.js");

/** O que se busca de cada vez: ~0,2 s a 10 MB/s, e o começo do vídeo chega logo. */
const CHUNK_BYTES = 2 * 1024 * 1024;
/** O que se entrega de cada vez a quem lê. */
const SLICE_BYTES = 1024 * 1024;
const CHUNK_RETRIES = 3;
const RETRY_DELAY_MS = 400;
const CHUNK_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const MIME = { video: "video/mp4", audio: "audio/mp4" };

/** Reaproveita a conexão TLS entre um pedaço e o seguinte. */
const agent = new https.Agent({ keepAlive: true, maxSockets: 6 });

/**
 * Busca [start, end] de uma URL do googlevideo. Devolve os bytes e o tamanho total do
 * arquivo (do `Content-Range`), que serve para descobrir o tamanho quando a URL não o diz.
 *
 * @returns {Promise<{ data: Buffer, total: number|null }>}
 */
function httpsRange(url, start, end, { signal, timeoutMs = CHUNK_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OnlineVideoError("cancelled", "Cancelado"));
      return;
    }
    const expected = end - start + 1;
    const req = https.request(
      url,
      { method: "GET", agent, headers: { Range: `bytes=${start}-${end}`, "User-Agent": USER_AGENT, Accept: "*/*" } },
      (res) => {
        const status = res.statusCode || 0;
        if (status !== 206 && !(status === 200 && start === 0)) {
          res.resume();
          const kind = status === 403 || status === 404 || status === 410 ? "forbidden" : "network";
          reject(new OnlineVideoError(kind, `HTTP ${status}`));
          return;
        }
        const chunks = [];
        let received = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (received > expected) {
            req.destroy(new OnlineVideoError("network", "Resposta maior que o pedido"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (received !== expected && status === 206) {
            reject(new OnlineVideoError("network", "Pedaço incompleto"));
            return;
          }
          const range = /\/(\d+)$/.exec(String(res.headers["content-range"] || ""));
          resolve({ data: Buffer.concat(chunks), total: range ? Number(range[1]) : null });
        });
        res.on("error", reject);
      }
    );
    const onAbort = () => req.destroy(new OnlineVideoError("cancelled", "Cancelado"));
    signal?.addEventListener("abort", onAbort, { once: true });
    req.setTimeout(timeoutMs, () => req.destroy(new OnlineVideoError("network", "Sem resposta do YouTube")));
    req.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error instanceof OnlineVideoError ? error : new OnlineVideoError("network", error.message));
    });
    req.on("close", () => signal?.removeEventListener("abort", onAbort));
    req.end();
  });
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Uma trilha (vídeo ou áudio): um arquivo do tamanho final, preenchido por pedaços, com
 * quem espera um trecho que ainda não chegou.
 */
class Track {
  constructor({
    kind,
    url,
    size,
    file,
    fetchRange,
    chunkBytes = CHUNK_BYTES,
    retryDelayMs = RETRY_DELAY_MS,
    now = Date.now,
    onData,
  }) {
    this.kind = kind;
    this.url = url;
    this.size = size;
    this.file = file;
    this.fetchRange = fetchRange;
    this.chunkBytes = chunkBytes;
    this.retryDelayMs = retryDelayMs;
    this.now = now;
    this.onData = onData;
    this.have = new RangeSet();
    this.controller = new AbortController();
    this.cursor = 0;
    /** Onde alguém está lendo e falta dado: o próximo pedaço vem de lá. */
    this.jump = null;
    this.fd = null;
    this.closed = false;
    this.error = null;
    this.complete = false;
    this.readers = 0;
    this.everRead = false;
    this.lastReadAt = now();
    this.waiters = [];
    this.pumping = null;
  }

  async open() {
    if (this.size == null) {
      const { total } = await this.fetchRange(this.url, 0, 0, { signal: this.controller.signal });
      if (!(total > 0)) throw new OnlineVideoError("format", "Tamanho do vídeo desconhecido");
      this.size = total;
    }
    await fs.ensureDir(path.dirname(this.file));
    this.fd = await fs.open(this.file, "w+");
    await fs.ftruncate(this.fd, this.size);
  }

  start() {
    this.pumping = this.pump();
    // Quem espera a trilha inteira trata a falha; sem ninguém ainda, não é "não tratada".
    this.pumping.catch(() => {});
    return this.pumping;
  }

  notify() {
    const waiting = this.waiters;
    this.waiters = [];
    for (const wake of waiting) wake();
  }

  nextEvent(signal) {
    return new Promise((resolve, reject) => {
      const entry = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        this.waiters = this.waiters.filter((w) => w !== entry);
        reject(new OnlineVideoError("cancelled", "Leitura cancelada"));
      };
      this.waiters.push(entry);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  nextGap() {
    const from = this.jump ?? this.cursor;
    this.jump = null;
    return this.have.firstGap(from, this.size) ?? this.have.firstGap(0, this.size);
  }

  async fetchWithRetry(start, end) {
    const signal = this.controller.signal;
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await this.fetchRange(this.url, start, end, { signal });
        if (data.length !== end - start + 1) throw new OnlineVideoError("network", "Pedaço incompleto");
        return data;
      } catch (error) {
        if (this.closed || signal.aborted) throw new OnlineVideoError("cancelled", "Download cancelado");
        const fatal = error instanceof OnlineVideoError && error.kind === "forbidden";
        if (fatal || attempt >= CHUNK_RETRIES) {
          throw error instanceof OnlineVideoError ? error : new OnlineVideoError("network", error.message);
        }
        await sleep(this.retryDelayMs * (attempt + 1), signal);
      }
    }
  }

  async pump() {
    try {
      while (!this.closed) {
        const gap = this.nextGap();
        if (!gap) {
          this.complete = true;
          this.notify();
          return;
        }
        const start = gap.start;
        const end = Math.min(gap.end, start + this.chunkBytes - 1);
        const data = await this.fetchWithRetry(start, end);
        if (this.closed) return;
        await fs.write(this.fd, data, 0, data.length, start);
        this.have.add(start, start + data.length - 1);
        this.cursor = start + data.length;
        this.onData?.(this);
        this.notify();
      }
    } catch (error) {
      if (!this.closed) this.error = error;
      this.notify();
      throw error;
    }
  }

  /** Alguém precisa deste ponto: o próximo pedaço vem de lá, sem esperar o resto na fila. */
  want(offset) {
    this.jump = offset;
  }

  /** Espera [start, end] estar no arquivo. Rejeita se a trilha falhou, foi fechada ou a leitura cancelada. */
  async ensure(start, end, signal) {
    while (!this.have.covers(start, end)) {
      if (this.error) throw this.error;
      if (this.closed) throw new OnlineVideoError("cancelled", "Download cancelado");
      if (signal?.aborted) throw new OnlineVideoError("cancelled", "Leitura cancelada");
      const gap = this.have.firstGap(start, end + 1);
      if (gap) this.want(gap.start);
      await this.nextEvent(signal);
    }
  }

  /** Lê [start, end] em fatias, esperando o que ainda não chegou. */
  async *readRange(start, end, signal) {
    this.readers++;
    this.everRead = true;
    try {
      let pos = start;
      while (pos <= end) {
        const sliceEnd = Math.min(end, pos + SLICE_BYTES - 1);
        await this.ensure(pos, sliceEnd, signal);
        const buf = Buffer.allocUnsafe(sliceEnd - pos + 1);
        const { bytesRead } = await fs.read(this.fd, buf, 0, buf.length, pos);
        if (bytesRead !== buf.length) throw new OnlineVideoError("format", "Arquivo do vídeo truncado");
        yield buf;
        pos = sliceEnd + 1;
      }
    } finally {
      this.readers--;
      this.lastReadAt = this.now();
    }
  }

  /** Para de baixar e acorda quem espera (eles recebem "cancelado"). */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.notify();
  }

  /** Fecha o arquivo e o apaga. */
  async dispose() {
    this.close();
    try {
      await this.pumping;
    } catch {
      /* já reportado */
    }
    if (this.fd != null) {
      const fd = this.fd;
      this.fd = null;
      await fs.close(fd).catch(() => {});
    }
    await fs.remove(this.file).catch(() => {});
  }
}

function parseRange(header, size) {
  const m = header && /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return { start, end };
}

/**
 * Uma sessão é o vídeo inteiro: a trilha de vídeo e a de áudio (ou uma só, quando o
 * formato já traz os dois), baixadas por um único par de conexões.
 *
 * @param {object} opts
 * @param {string} opts.id
 * @param {{ video: {url:string,size?:number|null}, audio: {url:string,size?:number|null}, muxed: boolean }} opts.streams
 * @param {string} opts.dir                pasta desta sessão
 * @param {typeof httpsRange} [opts.fetchRange]
 * @param {(p: { have: number, total: number }) => void} [opts.onProgress]
 */
async function openSession(opts) {
  const { id, streams, dir, fetchRange = httpsRange, onProgress, chunkBytes, retryDelayMs, now = Date.now } = opts;
  for (const kind of ["video", "audio"]) {
    if (!streamUrl(streams[kind]?.url)) throw new OnlineVideoError("format", "Link de vídeo inválido");
  }

  const onData = () => {
    if (!onProgress) return;
    const list = Object.values(tracks);
    onProgress({
      have: list.reduce((n, t) => n + t.have.bytes, 0),
      total: list.reduce((n, t) => n + t.size, 0),
    });
  };
  const make = (kind, file) =>
    new Track({
      kind,
      url: streams[kind].url,
      size: streams[kind].size ?? null,
      file: path.join(dir, file),
      fetchRange,
      chunkBytes,
      retryDelayMs,
      now,
      onData,
    });

  const tracks = { video: make("video", "video.mp4") };
  if (!streams.muxed) tracks.audio = make("audio", "audio.m4a");
  const trackOf = (kind) => (kind === "audio" && tracks.audio ? tracks.audio : tracks.video);

  try {
    await Promise.all(Object.values(tracks).map((t) => t.open()));
  } catch (error) {
    await Promise.all(Object.values(tracks).map((t) => t.dispose()));
    throw error;
  }

  const session = {
    id,
    dir,
    muxed: !!streams.muxed,
    tracks,
    /** Arquivos das trilhas, para juntar quando terminarem. */
    files: { video: tracks.video.file, audio: (tracks.audio || tracks.video).file },
    done: null,
    disposed: false,

    get readers() {
      return Object.values(tracks).reduce((n, t) => n + t.readers, 0);
    },
    get lastReadAt() {
      return Math.max(...Object.values(tracks).map((t) => t.lastReadAt));
    },
    /** Alguma janela já leu desta cópia (a de um pré-download que ninguém tocou nunca foi lida). */
    get everRead() {
      return Object.values(tracks).some((t) => t.everRead);
    },
    get totalBytes() {
      return Object.values(tracks).reduce((n, t) => n + t.size, 0);
    },

    abort() {
      for (const t of Object.values(tracks)) t.close();
    },

    /**
     * Responde a um pedido `Range` (como o de um <video>) com o que já está no disco,
     * esperando o que ainda não chegou.
     * @returns {{ status: number, headers: Record<string,string>, body: ReadableStream|null }}
     */
    serve(kind, rangeHeader, signal) {
      const track = trackOf(kind);
      const size = track.size;
      const headers = { "Content-Type": MIME[kind === "audio" ? "audio" : "video"], "Accept-Ranges": "bytes" };
      const range = parseRange(rangeHeader, size);
      if (!range) {
        return {
          status: 200,
          headers: { ...headers, "Content-Length": String(size) },
          body: Readable.toWeb(Readable.from(track.readRange(0, size - 1, signal), { objectMode: false })),
        };
      }
      if (range.start >= size || range.end < range.start) {
        return { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` }, body: null };
      }
      return {
        status: 206,
        headers: {
          ...headers,
          "Content-Length": String(range.end - range.start + 1),
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        },
        body: Readable.toWeb(Readable.from(track.readRange(range.start, range.end, signal), { objectMode: false })),
      };
    },

    /** Apaga os arquivos das trilhas. Quem ainda lê recebe erro. */
    async dispose() {
      if (this.disposed) return;
      this.disposed = true;
      await Promise.all(Object.values(tracks).map((t) => t.dispose()));
      await fs.remove(dir).catch(() => {});
    },
  };

  const pumps = Object.values(tracks).map((t) => t.start());
  session.done = Promise.all(pumps).then(
    () => undefined,
    (error) => {
      session.abort(); // uma trilha caiu: a outra não vale mais nada sozinha
      throw error;
    }
  );
  session.done.catch(() => {});
  return session;
}

module.exports = {
  CHUNK_BYTES,
  SLICE_BYTES,
  httpsRange,
  openSession,
};
