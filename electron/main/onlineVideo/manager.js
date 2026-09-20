"use strict";

const fs = require("fs-extra");
const nodeFs = require("fs");
const path = require("path");
const { createStore } = require("./store.js");
const runner = require("./runner.js");
const { isVideoId } = require("./ids.js");

const { OnlineVideoError, clampHeight, needsFreshTool } = runner;

const URL_PREFIX = "louvorja://onlinevideo/";
const DEFAULT_MAX_BYTES = 6 * 1024 ** 3;
/** Abaixo disso um vídeo de 1080p pode encher o disco no meio do culto. */
const MIN_FREE_BYTES = 1024 ** 3;
const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 250;
/**
 * A barra é uma só para o operador, mas o trabalho tem fases que recomeçam do
 * zero (cada ferramenta baixada, depois o vídeo). Na primeira vez as ferramentas
 * ocupam os primeiros 25% — 12 para o yt-dlp, o resto para o ffmpeg — e o vídeo
 * o restante; com as ferramentas já instaladas, o vídeo usa a barra inteira.
 */
const TOOLS_SHARE = 25;
const YTDLP_SHARE = 12;

async function defaultFreeBytes(dir) {
  try {
    await fs.ensureDir(dir);
    const s = await nodeFs.promises.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

function urlFor(id) {
  return `${URL_PREFIX}${id}.mp4`;
}

function fail(error) {
  const kind = error instanceof OnlineVideoError ? error.kind : "unknown";
  return { ok: false, error: { kind, message: error?.message || String(error) } };
}

/**
 * Coordena o download de vídeos do YouTube para o cache local.
 *
 * A projeção, o áudio e às vezes o OBS já disputam a CPU e a rede da máquina, e
 * dois vídeos de 1080p em paralelo demorariam o dobro cada um. Por isso cada raia
 * roda uma transferência por vez — mas são duas raias: o que o operador pede para
 * projetar agora (`foreground`) nunca espera atrás de um pré-download longo
 * (`background`), que só disputa a rede com ele pelo tempo que durar.
 *
 * @param {object} cfg
 * @param {string} cfg.dir             pasta do cache de vídeos
 * @param {ReturnType<typeof import("./tools.js").createTools>} cfg.tools
 * @param {number} [cfg.refreshCooldownMs]  intervalo mínimo entre renovações do yt-dlp (padrão: 1 h)
 */
function createManager(cfg) {
  const {
    dir,
    tools,
    run = runner.run,
    maxBytes = DEFAULT_MAX_BYTES,
    freeBytes = defaultFreeBytes,
    jsRuntime = () => undefined,
    now = Date.now,
    refreshCooldownMs = REFRESH_COOLDOWN_MS,
  } = cfg;

  const store = createStore(dir);
  const cacheDir = path.join(dir, ".ytdlp-cache");
  /** @type {Map<string, any>} */
  const jobs = new Map();
  const lanes = {
    foreground: { running: 0, waiters: [] },
    background: { running: 0, waiters: [] },
  };
  let lastRefreshAt = -Infinity;

  const transfersRunning = () => lanes.foreground.running + lanes.background.running;

  function grant(waiter) {
    const { job } = waiter;
    job.waiter = null;
    job.holding = job.priority;
    lanes[job.holding].running++;
    waiter.resolve();
  }

  function acquire(job) {
    return new Promise((resolve, reject) => {
      const waiter = { job, resolve };
      if (lanes[job.priority].running < 1) {
        grant(waiter);
        return;
      }
      job.waiter = waiter;
      lanes[job.priority].waiters.push(waiter);
      job.controller.signal.addEventListener(
        "abort",
        () => {
          if (!job.waiter) return;
          for (const lane of Object.values(lanes)) {
            const i = lane.waiters.indexOf(waiter);
            if (i >= 0) lane.waiters.splice(i, 1);
          }
          job.waiter = null;
          reject(new OnlineVideoError("cancelled", "Download cancelado"));
        },
        { once: true }
      );
    });
  }

  function release(job) {
    const lane = lanes[job.holding];
    lane.running--;
    const next = lane.waiters.shift();
    if (next) grant(next);
  }

  /**
   * O operador pediu para projetar um vídeo que só estava numa fila de pré-download:
   * ele passa para a raia do que é urgente. Se já está baixando, segue como está.
   */
  function promote(job) {
    if (job.priority === "foreground") return;
    job.priority = "foreground";
    const waiter = job.waiter;
    if (!waiter) return;
    const queue = lanes.background.waiters;
    const i = queue.indexOf(waiter);
    if (i >= 0) queue.splice(i, 1);
    if (lanes.foreground.running < 1) grant(waiter);
    else lanes.foreground.waiters.push(waiter);
  }

  function publish(job, payload, { force = false } = {}) {
    const t = now();
    if (!force && t - job.lastEmit < PROGRESS_INTERVAL_MS) return;
    job.lastEmit = t;
    // A barra só sobe: uma nova tentativa ou a renovação do yt-dlp no meio do
    // caminho não a faz voltar atrás.
    if (typeof payload.percent === "number" && payload.phase !== "error") {
      job.best = Math.max(job.best, payload.percent);
      payload = { ...payload, percent: job.best };
    }
    const evt = { id: job.id, ...payload };
    for (const listener of job.listeners) {
      try {
        listener(evt);
      } catch {
        /* ouvinte que já foi embora não derruba o download */
      }
    }
  }

  async function execute(job) {
    const { id, controller } = job;
    const signal = controller.signal;
    const startedAt = now();
    publish(job, { phase: "queued", percent: 0 }, { force: true });
    await acquire(job);
    try {
      let toolPaths;
      let installedTools = !tools.ready();
      // Um ffmpeg corrompido ou barrado pelo antivírus depois de instalado passa
      // despercebido: sem ele o yt-dlp NÃO falha — cai para o melhor formato que já
      // vem inteiro (360p) e o telão sairia borrado sem nenhum aviso. Conferir custa
      // ~50 ms. (O yt-dlp quebrado, esse, falha alto e é tratado mais abaixo.)
      if (!installedTools && !(await tools.ffmpegWorks())) {
        await tools.reset();
        installedTools = true;
      }
      const base = installedTools ? TOOLS_SHARE : 0;
      /** Progresso do vídeo (0–99) na parte da barra que sobra depois das ferramentas. */
      const overall = (p) => Math.round(base + (p * (99 - base)) / 99);

      if (installedTools) {
        publish(job, { phase: "tools", percent: 0, phasePercent: 0 }, { force: true });
        toolPaths = await tools.ensure({
          signal,
          onProgress: (p) => {
            const raw = p.total ? Math.round((p.received / p.total) * 100) : 0;
            const share =
              p.tool === "ffmpeg"
                ? YTDLP_SHARE + (raw * (TOOLS_SHARE - YTDLP_SHARE)) / 100
                : (raw * YTDLP_SHARE) / 100;
            publish(job, {
              phase: "tools",
              tool: p.tool,
              percent: Math.round(share),
              phasePercent: raw,
            });
          },
        });
      } else {
        toolPaths = tools.paths();
      }

      const free = await freeBytes(dir);
      if (free != null && free < MIN_FREE_BYTES) {
        throw new OnlineVideoError("disk", "Pouco espaço livre no disco");
      }

      const partial = store.partialDirFor(id);
      // Ferramentas recém-instaladas já passaram pela verificação do instalador:
      // uma falha logo depois não se resolve reinstalando de novo.
      let repaired = installedTools;
      let refreshed = false;
      let result;
      for (;;) {
        publish(job, { phase: "downloading", percent: overall(0), phasePercent: 0 }, { force: true });
        try {
          result = await run({
            tools: toolPaths,
            id,
            outDir: partial,
            maxHeight: job.maxHeight,
            cacheDir,
            jsRuntime: jsRuntime(),
            signal,
            onProgress: (p) =>
              publish(job, {
                phase: "downloading",
                percent: overall(p.percent),
                phasePercent: p.percent,
                downloaded: p.downloaded,
                total: p.total,
                speed: p.speed,
                eta: p.eta,
              }),
          });
          break;
        } catch (error) {
          const kind = error instanceof OnlineVideoError ? error.kind : "unknown";
          // Binário corrompido ou barrado pelo antivírus. Um yt-dlp quebrado falha ao
          // subir (kind "tool"), mas um ffmpeg quebrado só aparece ao juntar as
          // trilhas, com o mesmo erro genérico de um yt-dlp desatualizado — daí a
          // conferência antes de gastar 37 MB renovando o que não era o problema.
          const brokenTools = kind === "tool" || (needsFreshTool(kind) && !(await tools.works()));
          // Trocar os binários com outro download usando-os quebraria os dois (no
          // Windows o .exe em uso nem é sobrescrito): a manutenção espera um momento
          // em que este seja o único, e este vídeo cai no aviso normal de falha.
          const alone = transfersRunning() === 1;
          if (brokenTools && !repaired && alone) {
            repaired = true;
            await tools.reset();
            publish(job, { phase: "tools", percent: 0, phasePercent: 0 }, { force: true });
            toolPaths = await tools.ensure({ signal });
            continue;
          }
          if (needsFreshTool(kind) && !refreshed && alone && now() - lastRefreshAt > refreshCooldownMs) {
            refreshed = true;
            lastRefreshAt = now();
            publish(job, { phase: "tools", tool: "yt-dlp", percent: 0, phasePercent: 0 }, { force: true });
            await tools.refreshYtdlp({ signal });
            continue;
          }
          throw error;
        }
      }

      publish(job, { phase: "finalizing", percent: 99 }, { force: true });
      await fs.move(result.file, store.pathFor(id), { overwrite: true });
      await fs.remove(partial);
      if (job.keep) store.keep(id);
      try {
        await store.evict({ maxBytes, inUse: [id, ...jobs.keys()] });
      } catch {
        /* falha ao liberar espaço nunca invalida o download que deu certo */
      }

      publish(job, { phase: "done", percent: 100 }, { force: true });
      return {
        ok: true,
        id,
        url: urlFor(id),
        size: result.size,
        cached: false,
        meta: result.meta,
        durationMs: now() - startedAt,
        installedTools,
      };
    } finally {
      release(job);
    }
  }

  /**
   * Garante o vídeo em disco. Nunca rejeita: o chamador recebe `{ ok: false, error }`
   * e decide se cai no player do YouTube.
   */
  function ensure(id, opts = {}, onProgress) {
    if (!isVideoId(id)) {
      return Promise.resolve(fail(new OnlineVideoError("invalid", "ID de vídeo inválido")));
    }
    if (!tools.supported) {
      return Promise.resolve(fail(new OnlineVideoError("unsupported", "Plataforma sem suporte")));
    }
    if (store.has(id)) {
      store.touch(id);
      if (opts.keep) store.keep(id);
      return Promise.resolve({ ok: true, id, url: urlFor(id), size: 0, cached: true, meta: null });
    }

    const existing = jobs.get(id);
    if (existing && existing.controller.signal.aborted) {
      // Cancelado, mas ainda saindo (o yt-dlp leva um instante para morrer): quem pede
      // agora não herda o cancelamento. Espera o antigo largar a pasta de parciais e
      // recomeça, em vez de receber "cancelado" e não ver nada acontecer.
      return existing.promise.then(() => ensure(id, opts, onProgress));
    }
    if (existing) {
      if (onProgress) existing.listeners.add(onProgress);
      if (opts.keep) existing.keep = true;
      if (opts.priority !== "background") promote(existing);
      return existing.promise;
    }

    const job = {
      id,
      maxHeight: clampHeight(opts.maxHeight),
      priority: opts.priority === "background" ? "background" : "foreground",
      keep: opts.keep === true,
      holding: null,
      waiter: null,
      controller: new AbortController(),
      listeners: new Set(onProgress ? [onProgress] : []),
      lastEmit: 0,
      best: 0,
      promise: null,
    };
    job.promise = execute(job)
      .catch((error) => {
        publish(job, { phase: "error", percent: 0, kind: error?.kind }, { force: true });
        return fail(error);
      })
      .finally(() => {
        jobs.delete(id);
      });
    jobs.set(id, job);
    return job.promise;
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job) return false;
    job.controller.abort();
    return true;
  }

  function cancelAll() {
    for (const job of jobs.values()) job.controller.abort();
  }

  /**
   * Instala as ferramentas de antemão, em silêncio: quem abre os módulos de vídeo
   * vai querer tocar um, e o primeiro não deve pagar 20–40 s de instalação. Se o
   * operador pedir um vídeo no meio, o download aproveita a instalação em curso.
   */
  async function prepare() {
    if (!tools.supported) return fail(new OnlineVideoError("unsupported", "Plataforma sem suporte"));
    if (tools.ready()) return { ok: true, ready: true };
    try {
      await tools.ensure();
      return { ok: true, ready: true };
    } catch (error) {
      return fail(error);
    }
  }

  /** Manda manter um vídeo que já está no disco: o despejo por espaço não o leva. */
  function keep(id) {
    return isVideoId(id) && store.keep(id);
  }

  async function remove(id) {
    if (!isVideoId(id)) return false;
    cancel(id);
    await store.remove(id);
    return true;
  }

  async function clear() {
    cancelAll();
    return store.clear();
  }

  async function status() {
    const info = await tools.info();
    const items = await store.list();
    return {
      ...info,
      cacheDir: dir,
      count: items.length,
      size: items.reduce((s, v) => s + v.size, 0),
      active: [...jobs.keys()],
    };
  }

  async function list() {
    return store.list();
  }

  function init() {
    return store.sweepPartials();
  }

  return {
    store,
    tools,
    ensure,
    cancel,
    cancelAll,
    prepare,
    keep,
    remove,
    clear,
    status,
    list,
    init,
    urlFor,
  };
}

module.exports = { createManager, urlFor, URL_PREFIX, DEFAULT_MAX_BYTES, MIN_FREE_BYTES };
