"use strict";

const fs = require("fs-extra");
const nodeFs = require("fs");
const path = require("path");
const { performance } = require("node:perf_hooks");
const { createStore } = require("./store.js");
const runner = require("./runner.js");
const progressive = require("./progressive.js");
const { isVideoId } = require("./ids.js");

const { OnlineVideoError, clampHeight, needsFreshTool } = runner;

const URL_PREFIX = "louvorja://onlinevideo/";
/** O vídeo que ainda está sendo baixado, servido do arquivo que vai crescendo. */
const STREAM_PREFIX = "louvorja://onlinestream/";
/** Uma sessão pronta guarda as trilhas por este tempo: o <video> pausado pode voltar a pedir dados. */
const SESSION_IDLE_MS = 30 * 60 * 1000;
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

function streamUrlFor(id, kind) {
  return `${STREAM_PREFIX}${id}/${kind}`;
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
    resolve = runner.resolveStreams,
    mux = runner.muxCopy,
    openSession = progressive.openSession,
    fetchRange,
    maxBytes = DEFAULT_MAX_BYTES,
    freeBytes = defaultFreeBytes,
    jsRuntime = () => undefined,
    now = Date.now,
    monotonicNow = () => performance.now(),
    refreshCooldownMs = REFRESH_COOLDOWN_MS,
  } = cfg;

  const store = createStore(dir);
  const cacheDir = path.join(dir, ".ytdlp-cache");
  /** @type {Map<string, any>} */
  const jobs = new Map();
  /** Pedidos de URL direta em andamento (tocar já, sem baixar). */
  const resolutions = new Map();
  /** Vídeos tocando enquanto baixam, por ID: as trilhas em disco de que as janelas leem. */
  const sessions = new Map();
  const streamDir = path.join(dir, ".stream");
  let sessionSweep = null;
  const lanes = {
    foreground: { running: 0, waiters: [] },
    background: { running: 0, waiters: [] },
  };
  let lastRefreshAt = -Infinity;

  /** Vídeos tocando enquanto baixam: não usam as raias, mas contam como transferência em curso. */
  let streaming = 0;

  const transfersRunning = () => lanes.foreground.running + lanes.background.running + streaming;

  function grant(waiter) {
    const { job } = waiter;
    job.waiter = null;
    job.holding = job.priority;
    lanes[job.holding].running++;
    waiter.resolve();
  }

  function drainLane(priority) {
    const lane = lanes[priority];
    if (!lane || lane.running >= 1) return;
    const next = lane.waiters.shift();
    if (next) grant(next);
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
    if (job.bypass) {
      job.bypass = false;
      streaming--;
      return;
    }
    const lane = lanes[job.holding];
    lane.running--;
    drainLane(job.holding);
  }

  /**
   * O operador quer TOCAR um vídeo que só estava na fila de pré-download: ele sai da fila e
   * começa agora, sem ocupar raia (nada pode segurar o play, nem o fim de outro download).
   * Já contamos como transferência em curso, para a manutenção das ferramentas esperar.
   */
  function runNow(job) {
    const waiter = job.waiter;
    if (!waiter) return;
    for (const lane of Object.values(lanes)) {
      const i = lane.waiters.indexOf(waiter);
      if (i >= 0) lane.waiters.splice(i, 1);
    }
    job.waiter = null;
    job.priority = "foreground";
    job.bypass = true;
    job.streamingMode = true;
    streaming++;
    waiter.resolve();
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
    // O retrato de incidente precisa da fase mais recente mesmo quando a UI
    // descarta uma amostra intermediária pelo throttle de progresso.
    if (typeof payload.phase === "string") job.phase = payload.phase;
    if (!force && t - job.lastEmit < PROGRESS_INTERVAL_MS) return;
    job.lastEmit = t;
    // A barra só sobe: uma nova tentativa ou a renovação do yt-dlp no meio do
    // caminho não a faz voltar atrás.
    if (typeof payload.percent === "number" && payload.phase !== "error") {
      job.best = Math.max(job.best, payload.percent);
      payload = { ...payload, percent: job.best };
    }
    // O retrato de diagnóstico é lido apenas quando o runtime-health já está
    // emitindo um incidente. Guardar a fase não cria IPC nem I/O.
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
      job.mapPercent = overall;

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
          result = await fetchVideo(job, { toolPaths, partial, overall });
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
      return await deliver(job, partial, result, startedAt, installedTools);
    } finally {
      release(job);
    }
  }

  /**
   * Traz o vídeo para `partial`. O caminho normal é o mesmo do "tocar já": o yt-dlp só descobre
   * os links diretos e o main baixa as trilhas UMA vez, para arquivos que as janelas já podem ler
   * enquanto o download segue — assim quem manda tocar no meio do pré-download não espera.
   * Só quando o vídeo não tem trilhas servidas direto (formatos em fragmentos) o yt-dlp baixa.
   */
  async function fetchVideo(job, { toolPaths, partial, overall }) {
    const { id, controller } = job;
    const signal = controller.signal;
    const links = await resolveLinks(id, { maxHeight: job.maxHeight });
    if (signal.aborted) throw new OnlineVideoError("cancelled", "Download cancelado");
    if (links.ok) {
      await assertRoomFor(links);
      await openJobSession(job, links);
      job.settleReady(true);
      return assemble(job, partial);
    }
    // Só formatos em fragmentos: o yt-dlp sabe juntá-los, as janelas não conseguem ler. Quem
    // pedir para tocar enquanto ele baixa acompanha o download (não há o que ler antes do fim).
    if (links.error.kind !== "format") throw new OnlineVideoError(links.error.kind, links.error.message);
    job.settleReady(false);
    return run({
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
  }

  /** Espaço para as duas trilhas mais a cópia juntada; sem os tamanhos, o mínimo de sempre. */
  async function assertRoomFor(links) {
    const sizes = [links.video.size, links.muxed ? 0 : links.audio.size];
    const needed = sizes.every((n) => n > 0) ? Math.max(MIN_FREE_BYTES, (sizes[0] + sizes[1]) * 2.2) : MIN_FREE_BYTES;
    const free = await freeBytes(dir);
    if (free != null && free < needed) throw new OnlineVideoError("disk", "Pouco espaço livre no disco");
  }

  /** Abre as trilhas em disco de onde as janelas leem; o mesmo par de conexões serve a todas. */
  async function openJobSession(job, links) {
    const { id } = job;
    job.links = links;
    const session = await openSession({
      id,
      streams: links,
      dir: path.join(streamDir, id),
      fetchRange,
      now,
      onProgress: ({ have, total }) =>
        publish(job, {
          phase: "downloading",
          percent: job.mapPercent(total ? Math.round((have / total) * 95) : 0),
          phasePercent: total ? Math.round((have / total) * 100) : 0,
          downloaded: have,
          total,
        }),
    });
    job.session = session;
    sessions.set(id, session);
    if (job.controller.signal.aborted) session.abort();
    else job.controller.signal.addEventListener("abort", () => session.abort(), { once: true });
    return session;
  }

  /** As trilhas terminaram de chegar: junta num MP4 (só copia os pacotes) em `partial`. */
  async function assemble(job, partial) {
    const { id, session, controller } = job;
    await session.done;
    publish(job, { phase: "finalizing", percent: 97 }, { force: true });
    await fs.ensureDir(partial);
    const out = path.join(partial, `${id}.mp4`);
    // O yt-dlp que vai juntar o que baixamos já não entra: só o ffmpeg, que copia os pacotes.
    if (session.muxed) await fs.copyFile(session.files.video, out);
    else await mux({ ffmpeg: tools.paths().ffmpeg, video: session.files.video, audio: session.files.audio, out, signal: controller.signal });
    const size = (await fs.stat(out)).size;
    return { file: out, size, meta: { height: job.links.video.height ?? null, vcodec: job.links.video.vcodec ?? null } };
  }

  /** Entrega o MP4 pronto ao cache: guarda se o operador quis, libera espaço e avisa que acabou. */
  async function deliver(job, partial, result, startedAt, installedTools) {
    const { id } = job;
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
  }

  /**
   * O trabalho acabou (deu certo, falhou ou foi cancelado). A cópia em trilhas só fica se alguém
   * toca dela — as janelas seguem lendo até fecharem —; a de um pré-download que ninguém tocou
   * já não serve, o MP4 basta.
   */
  function settleJob(job) {
    if (jobs.get(job.id) === job) jobs.delete(job.id);
    job.settleReady?.(false);
    const { session } = job;
    if (!session) return;
    session.finishedAt = now();
    if (!job.played && !session.everRead && sessions.get(job.id) === session) void disposeSession(job.id);
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
      startedAt: now(),
      phase: "queued",
      best: 0,
      mapPercent: (p) => p,
      links: null,
      session: null,
      played: false,
      streamingMode: false,
      openError: null,
      ready: null,
      settleReady: null,
      promise: null,
    };
    // Quem mandar tocar este vídeo no meio do download espera só até as trilhas abrirem (`ready`).
    job.ready = new Promise((resolve) => (job.settleReady = resolve));
    job.promise = execute(job)
      .catch(async (error) => {
        job.openError ??= error;
        publish(job, { phase: "error", percent: 0, kind: error?.kind }, { force: true });
        // Falhou ou foi cancelado: as trilhas pela metade não servem a ninguém.
        await disposeSession(id);
        return fail(error);
      })
      .finally(() => settleJob(job));
    jobs.set(id, job);
    return job.promise;
  }

  function cancel(id) {
    const job = jobs.get(id);
    const resolution = resolutions.get(id);
    job?.controller.abort();
    resolution?.controller.abort();
    return !!(job || resolution);
  }

  function cancelAll() {
    for (const job of jobs.values()) job.controller.abort();
    for (const resolution of resolutions.values()) resolution.controller.abort();
  }

  /** Os links diretos do YouTube (vídeo e áudio) que o yt-dlp descobre em ~6 s; um pedido só por vídeo. */
  function resolveLinks(id, opts) {
    const existing = resolutions.get(id);
    if (existing && !existing.controller.signal.aborted) return existing.promise;

    const entry = { controller: new AbortController(), promise: null };
    entry.promise = Promise.resolve()
      .then(() =>
        resolve({
          tools: tools.paths(),
          id,
          maxHeight: clampHeight(opts.maxHeight),
          cacheDir,
          jsRuntime: jsRuntime(),
          signal: entry.controller.signal,
        })
      )
      .then(
        // Cancelado no mesmo instante em que os links chegaram: o cancelamento vale.
        (links) =>
          entry.controller.signal.aborted
            ? fail(new OnlineVideoError("cancelled", "Cancelado"))
            : { ok: true, id, ...links },
        (error) => fail(error)
      )
      .finally(() => {
        if (resolutions.get(id) === entry) resolutions.delete(id);
      });
    resolutions.set(id, entry);
    return entry.promise;
  }

  function streamInfo(job) {
    const { links } = job;
    return {
      ok: true,
      id: job.id,
      cached: false,
      video: { ...links.video, url: streamUrlFor(job.id, "video") },
      audio: { ...links.audio, url: streamUrlFor(job.id, "audio") },
      muxed: links.muxed,
      duration: links.duration,
    };
  }

  /** Apaga as sessões que não servem mais: o vídeo já terminou e ninguém lê há um bom tempo. */
  async function sweepSessions({ except } = {}) {
    const t = now();
    for (const [id, session] of sessions) {
      if (id === except || session.disposed || !session.finishedAt) continue;
      const idle = t - Math.max(session.lastReadAt, session.finishedAt) > SESSION_IDLE_MS;
      // `except` só livra a sessão do vídeo que está para começar de se apagar sozinha — não
      // força a saída das outras. Trocar de vídeo não fecha as janelas na hora: elas ainda podem
      // estar lendo o vídeo anterior quando este sweep roda, e apagar o arquivo debaixo de quem
      // lê é o que dá o "buga" (dispose() apaga o arquivo — "quem ainda lê recebe erro").
      if (idle) {
        sessions.delete(id);
        await session.dispose();
      }
    }
  }

  /**
   * Toca já, sem esperar o download: baixa o vídeo UMA vez, aos pedaços, para arquivos
   * que vão crescendo, e devolve endereços `louvorja://onlinestream/…` de onde todas as
   * janelas leem (projeção, retorno, operador, player) — sem rede e sem anúncio. Quando
   * as trilhas terminam viram o MP4 do cache, como um download normal.
   *
   * Só com as ferramentas instaladas: quem pede antes disso cai no caminho normal, que
   * as instala. Nunca rejeita.
   */
  async function stream(id, opts = {}) {
    const requestStartedAt = monotonicNow();
    const timings = { resolve_ms: 0, session_open_ms: 0, join_wait_ms: 0, total_ms: 0 };
    const elapsed = (start) => {
      const value = monotonicNow() - start;
      return Number.isFinite(value) ? Math.round(Math.min(600_000, Math.max(0, value))) : 0;
    };
    const withTimings = (result) => ({
      ...result,
      timings: { ...timings, total_ms: elapsed(requestStartedAt) },
    });
    if (!isVideoId(id)) return fail(new OnlineVideoError("invalid", "ID de vídeo inválido"));
    if (!tools.supported) return fail(new OnlineVideoError("unsupported", "Plataforma sem suporte"));

    const cached = () => {
      store.touch(id);
      if (opts.keep) store.keep(id);
      const url = urlFor(id);
      return withTimings({ ok: true, id, cached: true, video: { url }, audio: { url }, muxed: true, duration: null });
    };
    if (store.has(id)) return cached();
    if (!tools.ready()) return fail(new OnlineVideoError("tools", "Ferramentas ainda não instaladas"));

    const join = async (job) => {
      if (job.controller.signal.aborted) {
        // Cancelado, mas ainda saindo: quem pede agora não herda o cancelamento.
        await job.promise;
        return stream(id, opts);
      }
      // Um pré-download em curso (ou na fila): o operador quer TOCAR. Ele sai da fila e o vídeo
      // toca das trilhas que já estão sendo baixadas, sem esperar o fim.
      runNow(job);
      job.played = true;
      if (opts.keep) job.keep = true;
      const joinStartedAt = monotonicNow();
      const opened = await job.ready;
      timings.join_wait_ms = elapsed(joinStartedAt);
      if (opened) return withTimings(streamInfo(job));
      if (job.openError) return fail(job.openError);
      // Só há formatos em fragmentos e o yt-dlp está baixando: não há trilha para ler antes do
      // fim. Ele passa a ser o urgente, e quem pediu decide se espera.
      promote(job);
      return fail(new OnlineVideoError("busy", "Este vídeo já está sendo baixado"));
    };

    const running = jobs.get(id);
    if (running) return join(running);

    const resolveStartedAt = monotonicNow();
    const links = await resolveLinks(id, opts);
    timings.resolve_ms = elapsed(resolveStartedAt);
    if (!links.ok) return links;
    // Enquanto os links chegavam, o mesmo vídeo pode ter sido baixado ou pedido de novo.
    if (store.has(id)) return cached();
    const raced = jobs.get(id);
    if (raced) return join(raced);

    try {
      await assertRoomFor(links);
    } catch (error) {
      return fail(error);
    }
    await sweepSessions({ except: id });
    // Última checagem antes do primeiro ponto sem `await`: a partir daqui o job já consta em `jobs`.
    const late = jobs.get(id);
    if (late) return join(late);
    if (store.has(id)) return cached();

    const job = {
      id,
      maxHeight: clampHeight(opts.maxHeight),
      priority: "foreground",
      keep: opts.keep === true,
      // O operador está esperando: não entra em fila nenhuma (são duas conexões curtas, e
      // nada pode segurar o "tocar já"), mas conta como transferência para a manutenção
      // das ferramentas — que não pode trocar o ffmpeg no meio de uma junção.
      holding: null,
      waiter: null,
      controller: new AbortController(),
      listeners: new Set(),
      lastEmit: 0,
      startedAt: now(),
      phase: "resolving",
      best: 0,
      mapPercent: (p) => p,
      links: null,
      session: null,
      played: true,
      streamingMode: true,
      openError: null,
      ready: null,
      settleReady: null,
      promise: null,
    };
    streaming++;
    const startedAt = now();
    const openStartedAt = monotonicNow();
    job.ready = openJobSession(job, links).then(
      () => true,
      (error) => {
        job.openError = error;
        return false;
      }
    );
    job.promise = job.ready
      .then(async (opened) => {
        if (!opened) throw job.openError;
        const partial = store.partialDirFor(id);
        const result = await assemble(job, partial);
        return deliver(job, partial, result, startedAt, false);
      })
      .catch(async (error) => {
        publish(job, { phase: "error", percent: 0, kind: error?.kind }, { force: true });
        // Falhou ou foi cancelado: as trilhas pela metade não servem a ninguém.
        await disposeSession(id);
        return fail(error);
      })
      .finally(() => {
        streaming--;
        settleJob(job);
      });
    jobs.set(id, job);

    const opened = await job.ready;
    timings.session_open_ms = elapsed(openStartedAt);
    if (!opened) return fail(job.openError);
    publish(job, { phase: "downloading", percent: 0 }, { force: true });
    return withTimings(streamInfo(job));
  }

  /**
   * Responde a um pedido `Range` das janelas com o que já está em disco do vídeo que
   * ainda baixa, esperando o que não chegou. null se não há sessão deste vídeo.
   */
  function serveStream(id, kind, rangeHeader, signal) {
    if (!isVideoId(id) || (kind !== "video" && kind !== "audio")) return null;
    const session = sessions.get(id);
    if (!session || session.disposed) return null;
    return session.serve(kind, rangeHeader, signal);
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

  /**
   * Manda manter o vídeo: o despejo por espaço não o leva. Se ele ainda está baixando (o
   * "tocar já" projeta antes de o arquivo existir), fica marcado e é guardado quando terminar.
   */
  function keep(id) {
    if (!isVideoId(id)) return false;
    const running = jobs.get(id);
    if (running) {
      running.keep = true;
      return true;
    }
    return store.keep(id);
  }

  async function disposeSession(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.dispose();
  }

  async function remove(id) {
    if (!isVideoId(id)) return false;
    cancel(id);
    await disposeSession(id);
    await store.remove(id);
    return true;
  }

  async function clear() {
    cancelAll();
    await Promise.all([...sessions.keys()].map(disposeSession));
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

  /**
   * Estado compacto e estritamente em memória para enriquecer um incidente
   * raro. Não expõe IDs, URLs, títulos ou caminhos; tampouco chama o store ou
   * ferramentas, porque o coletor de runtime-health não pode criar carga
   * durante um travamento.
   */
  function diagnosticSnapshot() {
    const ageBucket = (job) => {
      const age = Math.max(0, now() - job.startedAt);
      if (age < 10_000) return "lt_10s";
      if (age < 60_000) return "10s_1m";
      if (age < 5 * 60_000) return "1m_5m";
      return "gte_5m";
    };
    const compactJob = (job) => ({
      priority: job.priority === "background" ? "background" : "foreground",
      lane: job.streamingMode ? "streaming" : job.holding || (job.waiter ? "queued" : "resolving"),
      phase: typeof job.phase === "string" ? job.phase.slice(0, 40) : "unknown",
      played: job.played === true,
      age_bucket: ageBucket(job),
    });

    return {
      online_video_manager_initialized: true,
      online_video_active_count: jobs.size,
      online_video_resolving_count: resolutions.size,
      online_video_session_count: sessions.size,
      online_video_foreground_running: lanes.foreground.running,
      online_video_background_running: lanes.background.running,
      online_video_foreground_queued: lanes.foreground.waiters.length,
      online_video_background_queued: lanes.background.waiters.length,
      online_video_streaming: streaming,
      online_video_jobs: [...jobs.values()].slice(0, 8).map(compactJob),
    };
  }

  async function list() {
    return store.list();
  }

  async function init() {
    // Recém-aberto o app, nada pode estar lendo as trilhas de um vídeo que baixava antes.
    await fs.remove(streamDir).catch(() => {});
    if (!sessionSweep) {
      sessionSweep = setInterval(() => void sweepSessions().catch(() => {}), 60_000);
      sessionSweep.unref?.();
    }
    return store.sweepPartials();
  }

  return {
    store,
    tools,
    ensure,
    stream,
    serveStream,
    cancel,
    cancelAll,
    prepare,
    keep,
    remove,
    clear,
    status,
    diagnosticSnapshot,
    list,
    init,
    urlFor,
  };
}

module.exports = {
  createManager,
  urlFor,
  streamUrlFor,
  URL_PREFIX,
  STREAM_PREFIX,
  DEFAULT_MAX_BYTES,
  MIN_FREE_BYTES,
  SESSION_IDLE_MS,
};
