/**
 * Vídeo online no Electron de verdade: o yt-dlp e o ffmpeg reais baixam um
 * vídeo real do YouTube e o app o projeta como arquivo local, em projeção,
 * retorno e operador, sem nenhum player do YouTube (logo, sem anúncio).
 *
 * Rode com o Vite no ar (porta 5002) e internet:
 *   VITE_TARGET=desktop npx vite --port 5002 --strictPort
 *   LJ_RUN_ELECTRON_ONLINE_VIDEO=1 npx playwright test e2e/online-video.electron.spec.js \
 *     --reporter=line
 * PowerShell (em dois terminais):
 *   $env:VITE_TARGET="desktop"; npx vite --port 5002 --strictPort
 *   $env:LJ_RUN_ELECTRON_ONLINE_VIDEO="1"
 *   npx playwright test e2e/online-video.electron.spec.js --reporter=line
 *
 * É opt-in: baixa ~130 MB na primeira vez e abre janelas de verdade na tela.
 * Usa um perfil isolado (LJ_E2E_USER_DATA), então convive com o app do usuário.
 * Windows usa PowerShell apenas para observar subprocessos e taskkill somente
 * como fallback se o encerramento coordenado do Electron não responder.
 */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeProcess from "node:process";
import { closeElectronApp, processesMentioning } from "./helpers/electron-processes.mjs";

test.skip(
  !nodeProcess.env.LJ_RUN_ELECTRON_ONLINE_VIDEO,
  "opt-in: precisa de Electron real e internet"
);
test.describe.configure({ mode: "serial" });

/** Clipe de 4 min do catálogo do app, com 1080p em H.264. */
const LONG = "T8YHfGrk3ok";
/** 19 s, o menor vídeo público. */
const SHORT = "jNQXAC9IVRw";
const MISSING = "zzzzzzzzzzz";

const embed = (id) => `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&controls=0`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const toolName = (name) => `${name}${nodeProcess.platform === "win32" ? ".exe" : ""}`;

let app;
let main;
let root;
/** Últimas mensagens de aviso/erro do console da janela principal: é o que explica uma tela que não apareceu. */
const mainConsole = [];
const requests = [];
/**
 * Por onde o app importa cada módulo. O Vite acrescenta `?t=` aos módulos
 * invalidados por HMR (qualquer edição no grafo, com o servidor no ar); importar
 * pelo caminho puro criaria uma segunda instância, com estado e elemento de
 * áudio zerados — o teste leria um player que nunca tocou nada.
 */
const modules = {};

async function until(fn, { timeout = 15_000, interval = 150, label = "condição" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* janela ainda carregando */
    }
    await sleep(interval);
  }
  throw new Error(`Tempo esgotado esperando ${label} (último: ${JSON.stringify(last)})`);
}

/** Mantém um orçamento real para a ação urgente sem deixar um timer pendurado após sucesso. */
async function within(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tempo esgotado esperando ${label}`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function route(page) {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return "";
  }
}

function windows() {
  const all = app.windows().filter((p) => !p.isClosed());
  const by = (p) => all.find((w) => route(w) === p);
  return {
    main: by("/"),
    projection: by("/projection/file"),
    ret: by("/projection/file/return"),
    operator: by("/operator"),
    all,
  };
}

/** Janelas que não são a principal. */
const auxiliaries = () => windows().all.filter((w) => route(w) !== "/");

function readVideo(page) {
  return page.evaluate(() => {
    const v = document.querySelector("video");
    const frames = [...document.querySelectorAll("iframe")].map((f) => f.src);
    return v
      ? {
          sampledAtMs: performance.timeOrigin + performance.now(),
          t: v.currentTime,
          playbackRate: v.playbackRate,
          paused: v.paused,
          muted: v.muted,
          w: v.videoWidth,
          h: v.videoHeight,
          src: v.currentSrc,
          ready: v.readyState,
          networkState: v.networkState,
          errorCode: v.error?.code ?? null,
          dur: v.duration,
          frames,
        }
      : { none: true, frames };
  });
}

function readAudio() {
  return main.evaluate(async (url) => {
    const { useAudioPlayback } = await import(/* @vite-ignore */ url);
    const el = useAudioPlayback().getElement();
    return {
      sampledAtMs: performance.timeOrigin + performance.now(),
      t: el.currentTime,
      playbackRate: el.playbackRate,
      ready: el.readyState,
      paused: el.paused,
      muted: el.muted,
      volume: el.volume,
      src: el.currentSrc,
      dur: el.duration,
      networkState: el.networkState,
      errorCode: el.error?.code ?? null,
      userActivation: navigator.userActivation?.hasBeenActive ?? null,
      visibility: document.visibilityState,
    };
  }, modules.audio);
}

async function snapshot() {
  const w = windows();
  const [projection, ret, operator, audio] = await Promise.all([
    w.projection ? readVideo(w.projection) : null,
    w.ret ? readVideo(w.ret) : null,
    w.operator ? readVideo(w.operator) : null,
    readAudio(),
  ]);
  return { projection, ret, operator, audio };
}

/** A small, failure-only timeline for the main media element; no source or title. */
async function startCachedReopenProbe() {
  await main.evaluate(() => {
    const events = [];
    const eventNames = ["loadstart", "canplay", "playing", "pause", "abort", "error", "waiting"];
    const record = (name, el, reason = null) => {
      if (el?.id !== "__audio") return;
      events.push({
        name,
        atMs: performance.timeOrigin + performance.now(),
        currentTime: Number.isFinite(el.currentTime) ? el.currentTime : null,
        readyState: el.readyState,
        networkState: el.networkState,
        errorCode: el.error?.code ?? null,
        paused: el.paused,
        reason,
      });
      if (events.length > 40) events.shift();
    };
    const onEvent = (event) => record(event.type, event.target);
    for (const name of eventNames) document.addEventListener(name, onEvent, true);
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (this.id === "__audio") record("play_called", this);
      const promise = originalPlay.apply(this, args);
      if (this.id === "__audio" && promise?.then) {
        void promise.then(
          () => record("play_resolved", this),
          (error) => {
            const name = error?.name;
            const reason = [
              "AbortError",
              "NotAllowedError",
              "NotSupportedError",
              "InvalidStateError",
            ].includes(name)
              ? name
              : "other";
            record("play_rejected", this, reason);
          }
        );
      }
      return promise;
    };
    window.__cachedReopenProbe = {
      events,
      stop() {
        HTMLMediaElement.prototype.play = originalPlay;
        for (const name of eventNames) document.removeEventListener(name, onEvent, true);
      },
    };
  });
}

/** Only numeric media state and the local scheme class leave a failed test. */
function diagnosticMedia(media) {
  if (!media) return { exists: false };
  if (media.none) return { exists: false, elementMissing: true };
  const srcClass = media.src?.startsWith("louvorja://onlinestream/")
    ? "progressive"
    : media.src?.startsWith("louvorja://onlinevideo/")
      ? "cached"
      : media.src
        ? "other"
        : "empty";
  return {
    exists: true,
    srcClass,
    readyState: media.ready,
    networkState: media.networkState,
    errorCode: media.errorCode,
    currentTime: media.t,
    playbackRate: media.playbackRate,
    paused: media.paused,
    sampledAtMs: media.sampledAtMs,
    ...(media.userActivation !== undefined ? { userActivation: media.userActivation } : {}),
    ...(media.visibility !== undefined ? { visibility: media.visibility } : {}),
  };
}

const openOnline = (id) =>
  main.evaluate(([url]) => window.__media.openYouTube(url, "Teste E2E"), [embed(id)]);

/** O download de antemão (botão de baixar, link novo na lista), pelo mesmo composable da tela. */
const downloadFromList = (id, name) =>
  main.evaluate(
    async ([url, v, n]) => {
      const { useOnlineVideoDownloads } = await import(/* @vite-ignore */ url);
      return useOnlineVideoDownloads().download(v, n);
    },
    [modules.downloads, id, name]
  );

/** Apaga o vídeo do disco pelo composable: o cartão e a lista de arquivos ficam de acordo. */
const removeFromList = (id) =>
  main.evaluate(
    async ([url, v]) => {
      const { useOnlineVideoDownloads } = await import(/* @vite-ignore */ url);
      return useOnlineVideoDownloads().remove(v);
    },
    [modules.downloads, id]
  );

/** As trilhas de um vídeo que ainda baixa (a cópia que as janelas leem) ficam aqui. */
const streamDirOf = (id) => path.join(root, "online_videos", ".stream", id);

const tasks = () =>
  main.evaluate(async (url) => {
    const { useBackgroundTasks } = await import(/* @vite-ignore */ url);
    return JSON.parse(JSON.stringify(useBackgroundTasks().tasks.value));
  }, modules.tasks);

/**
 * A tarefa que está baixando agora. A de um download anterior do mesmo vídeo
 * continua na lista, concluída e com 100%: sem checar o status, uma sondagem
 * feita antes do primeiro evento do download novo a tomaria por progresso.
 */
const downloadingTask = async (id) => {
  const t = (await tasks()).find((x) => x.id === `online-video:${id}`);
  return t && t.status === "running" && t.progress > 3 ? t : null;
};

const snackbar = () => main.evaluate(() => window.__appdata.get("snackbar.text"));

const status = () => main.evaluate(() => window.louvorjaApi.onlineVideo.status());

const media = (expr, ...args) =>
  main.evaluate(({ expr: e, args: a }) => window.__media[e](...a), { expr, args });

/**
 * Requisições para o YouTube ou para rede de anúncios. Olha só o HOST: o Vite
 * serve arquivos do próprio app chamados `useYouTubeApi.ts` e `YouTubeError.ts`,
 * que têm "youtube" no caminho e nada a ver com rede externa.
 */
function externalAdOrYoutube(list) {
  return list
    .filter((r) => {
      try {
        return /(^|\.)(youtube\.com|youtube-nocookie\.com|googlevideo\.com|ytimg\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com)$/i.test(
          new URL(r.url).hostname
        );
      } catch {
        return false;
      }
    })
    .map((r) => `${r.page} ${r.url}`);
}

async function closeMedia() {
  await media("close", true);
  await until(() => auxiliaries().length === 0, {
    timeout: 10_000,
    label: "janelas auxiliares fecharem",
  });
}

async function setPref(key, value) {
  await main.evaluate(([k, v]) => window.__userdata.set(k, v), [key, value]);
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-online-video-e2e-"));
  const env = { ...nodeProcess.env, ELECTRON_DEV: "1", LJ_E2E_USER_DATA: root };
  delete env.ELECTRON_RUN_AS_NODE;

  app = await electron.launch({ args: ["."], env, timeout: 90_000 });
  app.on("window", (page) => {
    page.on("request", (r) => requests.push({ at: Date.now(), page: route(page), url: r.url() }));
  });

  main = await until(() => windows().main, { timeout: 90_000, label: "janela principal" });
  main.on("console", (m) => {
    if (["warning", "error"].includes(m.type()) || /\[vite\]/i.test(m.text())) {
      mainConsole.push(
        `${new Date().toISOString().slice(11, 19)} ${m.type()}: ${m.text().slice(0, 240)}`
      );
      if (mainConsole.length > 60) mainConsole.shift();
    }
  });
  main.on("pageerror", (e) =>
    mainConsole.push(
      `${new Date().toISOString().slice(11, 19)} pageerror: ${String(e.message).slice(0, 240)}`
    )
  );
  await main.waitForLoadState("domcontentloaded");
  await sleep(3000);
  await main.keyboard.press("Escape"); // fecha o diálogo de verificação inicial
  await until(() => main.evaluate(() => !!window.__userdata && !!window.louvorjaApi), {
    label: "app pronto",
  });
  await main.evaluate(async () => {
    window.__media = (await import("/src/composables/useMedia.ts")).default;
  });
  for (const [key, name] of [
    ["audio", "useAudioPlayback"],
    ["tasks", "useBackgroundTasks"],
    ["downloads", "useOnlineVideoDownloads"],
  ]) {
    modules[key] = await main.evaluate(async (n) => {
      const source = await (await fetch("/src/composables/useMedia.ts")).text();
      const found = source.match(new RegExp(`"(/src/composables/${n}\\.ts[^"]*)"`));
      return found ? found[1] : `/src/composables/${n}.ts`;
    }, name);
  }

  // Arranjo modesto de igreja: um monitor só faz os três papéis; janelas comuns
  // para não cobrir a tela de quem está rodando o teste.
  await main.evaluate(async () => {
    const { displays } = window.louvorjaApi;
    const [d] = await displays.list();
    for (const role of ["projection", "stage", "operator"]) await displays.setRole(role, d.id);
  });
  await setPref("options.online_video_projection.fullscreen", false);
  await setPref("options.online_video_projection.always_on_top", false);
  await setPref("options.online_video_projection.show_return", true);
  await setPref("options.open_operator", true);
});

test.afterAll(async () => {
  const electronPid = app?.process()?.pid;
  const closed = await closeElectronApp(app);
  if (closed.forced) {
    console.warn(`[e2e] Electron PID ${electronPid} exigiu encerramento forçado`);
  }
  if (root) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test.describe("primeiro uso: instala as ferramentas e baixa um 1080p", () => {
  test.setTimeout(420_000);

  test("baixar instala as ferramentas e mostra o progresso; o vídeo baixado projeta nas três janelas sem o player do YouTube", async () => {
    expect((await status()).ready).toBe(false);
    const startedAt = Date.now();
    requests.length = 0;

    // O download de antemão (botão, ou link novo na lista): na primeira vez instala as ferramentas.
    const downloading = downloadFromList(LONG, "Vídeo longo (E2E)");

    // 1) O download aparece nos processos em segundo plano, com progresso que sobe.
    const seen = [];
    let sawTools = false;
    while (true) {
      const list = await tasks();
      const t = list.find((x) => x.id === `online-video:${LONG}`);
      if (t) {
        seen.push(t.progress);
        if (/ferramentas/i.test(t.detail || "")) sawTools = true;
        if (t.status !== "running") break;
      }
      const done = await Promise.race([downloading.then(() => true), sleep(700).then(() => false)]);
      if (done) break;
    }
    const downloaded = await downloading;
    const elapsed = Date.now() - startedAt;
    console.log(
      `[e2e] primeiro download (com instalação das ferramentas): ${(elapsed / 1000).toFixed(1)} s`
    );

    expect(downloaded).toBe(true);
    expect(sawTools, "deve ter avisado que prepara as ferramentas na primeira vez").toBe(true);
    expect(seen.length).toBeGreaterThan(3);
    // Progresso parado nas ferramentas quase sempre é o download falhando (o YouTube pode pedir
    // "confirme que não é um robô" a um IP com muitas execuções seguidas): o aviso mostra o porquê.
    expect(
      Math.max(...seen),
      `progresso visto: ${seen.join(",")}; aviso na tela: ${(await snackbar()) ?? "nenhum"}`
    ).toBeGreaterThan(50);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] - 1);
    expect((await status()).ready).toBe(true);
    expect((await status()).count).toBe(1);

    // Agora que está no disco, o vídeo toca do arquivo.
    expect(await openOnline(LONG)).toBe(true);

    // 2) As três janelas existem.
    const w = await until(
      () => {
        const x = windows();
        return x.projection && x.ret && x.operator ? x : null;
      },
      { timeout: 20_000, label: "projeção, retorno e operador" }
    );
    expect(w.all.length).toBe(4);

    // 3) Todas tocam o arquivo baixado, em 1080p, e nenhuma tem player do YouTube.
    let lastSnapshot = null;
    let lastError = null;
    const ready = await until(
      async () => {
        let s;
        try {
          s = await snapshot();
        } catch (error) {
          lastError = String(error.message).split("\n")[0];
          throw error;
        }
        lastSnapshot = s;
        const vids = [s.projection, s.ret, s.operator];
        return vids.every((v) => v && !v.none && v.ready >= 3 && !v.paused && v.t > 0.5) &&
          !s.audio.paused
          ? s
          : null;
      },
      { timeout: 25_000, label: "as três janelas e o áudio tocando" }
    ).catch((error) => {
      throw new Error(
        `${error.message}\nsnapshot: ${JSON.stringify(lastSnapshot)}\nerro do último poll: ${lastError}\nmódulos: ${JSON.stringify(modules)}`
      );
    });
    for (const [name, v] of Object.entries({
      projeção: ready.projection,
      retorno: ready.ret,
      operador: ready.operator,
    })) {
      expect(v.src, name).toBe(`louvorja://onlinevideo/${LONG}.mp4`);
      expect([v.w, v.h], `${name}: resolução`).toEqual([1920, 1080]);
      expect(v.muted, `${name} deve ficar sem som (o áudio sai da janela principal)`).toBe(true);
      expect(v.frames, `${name}: nenhum iframe`).toEqual([]);
    }
    expect(ready.audio.src).toBe(`louvorja://onlinevideo/${LONG}.mp4`);
    expect(ready.audio.muted).toBe(false);
    expect(ready.audio.volume).toBeGreaterThan(0);

    // 4) Nada de rede do YouTube depois que o vídeo abriu (o yt-dlp roda fora das janelas).
    await sleep(2500);
    const afterOpen = requests.filter((r) => r.at >= startedAt);
    expect(externalAdOrYoutube(afterOpen)).toEqual([]);
  });

  test("as janelas seguem o áudio: deriva medida entre imagem e som", async () => {
    const offsets = { projection: [], ret: [], operator: [] };
    const advance = [];

    // A imagem se alinha ao som acelerando/freando um pouco, sem saltos: dá tempo de convergir.
    const worstGap = (s) =>
      Math.max(...["projection", "ret", "operator"].map((k) => Math.abs(s[k].t - s.audio.t)));
    const t0 = Date.now();
    await until(async () => worstGap(await snapshot()) < 0.1, {
      timeout: 15_000,
      interval: 250,
      label: "imagem e som alinhados (< 100 ms nas três janelas)",
    });
    console.log(`[e2e] tempo até alinhar imagem e som: ${Date.now() - t0} ms`);

    for (let i = 0; i < 8; i++) {
      const before = await snapshot();
      await sleep(600);
      const s = await snapshot();
      for (const k of Object.keys(offsets)) offsets[k].push(s[k].t - s.audio.t);
      advance.push(s.audio.t - before.audio.t);
    }
    const report = Object.fromEntries(
      Object.entries(offsets).map(([k, xs]) => [
        k,
        {
          mediana_ms: Math.round(median(xs) * 1000),
          pior_ms: Math.round(Math.max(...xs.map(Math.abs)) * 1000),
        },
      ])
    );
    console.log("[e2e] deriva imagem-áudio:", JSON.stringify(report));
    expect(median(advance)).toBeGreaterThan(0.5); // o tempo anda de verdade
    // Sem compensar a idade da mensagem, a imagem ficava ~0,3 s atrás do som; só buscando,
    // o erro que sobrava depois da busca (0,15–0,3 s) nunca era corrigido.
    for (const [name, xs] of Object.entries(offsets)) {
      expect(Math.abs(median(xs)), `${name}: mediana`).toBeLessThan(0.1);
      expect(Math.max(...xs.map(Math.abs)), `${name}: pior caso`).toBeLessThan(0.2);
    }
  });

  test("pausar, buscar, retomar e volume chegam às três janelas", async () => {
    await media("pause", true);
    await until(
      async () => {
        const s = await snapshot();
        return [s.projection, s.ret, s.operator].every((v) => v.paused) && s.audio.paused;
      },
      { timeout: 4000, label: "todas pausarem" }
    );

    await media("goToTime", 120);
    const sought = await until(
      async () => {
        const s = await snapshot();
        const near = [s.projection, s.ret, s.operator].every((v) => Math.abs(v.t - 120) < 2);
        return near && Math.abs(s.audio.t - 120) < 2 ? s : null;
      },
      { timeout: 6000, label: "todas irem para 2:00" }
    );
    expect(sought.audio.paused).toBe(true);

    await media("pause", false);
    const resumed = await until(
      async () => {
        const s = await snapshot();
        return [s.projection, s.ret, s.operator].every((v) => !v.paused && v.t > 120.5) &&
          !s.audio.paused
          ? s
          : null;
      },
      { timeout: 8000, label: "todas retomarem" }
    );
    expect(resumed.audio.t).toBeGreaterThan(120);

    await media("setVolume", 0);
    expect((await readAudio()).volume).toBe(0);
    await media("setVolume", 100);
    expect((await readAudio()).volume).toBe(1);
  });

  test("fechar derruba as janelas, o áudio e não deixa processo de download", async () => {
    await closeMedia();
    expect((await readAudio()).paused).toBe(true);
    expect(await processesMentioning(LONG)).toEqual([]);
    expect((await status()).count).toBe(1); // o arquivo continua no cache
  });
});

test.describe("depois de baixado", () => {
  test.setTimeout(120_000);

  test("reabrir vem do cache: rápido, sem tarefa de download e sem rede do YouTube", async () => {
    requests.length = 0;
    await startCachedReopenProbe();
    const startedAt = Date.now();
    const opened = await openOnline(LONG);
    expect(opened).toBe(true);
    expect(
      (await tasks()).some((t) => t.id === `online-video:${LONG}` && t.status === "running")
    ).toBe(false);

    let lastPlaybackSnapshot = null;
    const playing = await until(
      async () => {
        const s = await snapshot();
        lastPlaybackSnapshot = s;
        return [s.projection, s.ret, s.operator].every(
          (v) => v && !v.none && !v.paused && v.t > 0.3
        ) && !s.audio.paused
          ? s
          : null;
      },
      { timeout: 20_000, label: "as três janelas tocando" }
    )
      .catch(async (error) => {
        const events = await main
          .evaluate(() => window.__cachedReopenProbe?.events ?? [])
          .catch(() => []);
        await test.info().attach("cached-reopen-numeric", {
          body: Buffer.from(
            JSON.stringify(
              {
                projection: diagnosticMedia(lastPlaybackSnapshot?.projection),
                return: diagnosticMedia(lastPlaybackSnapshot?.ret),
                operator: diagnosticMedia(lastPlaybackSnapshot?.operator),
                audio: diagnosticMedia(lastPlaybackSnapshot?.audio),
                events,
              },
              null,
              2
            )
          ),
          contentType: "application/json",
        });
        throw error;
      })
      .finally(async () => {
        await main.evaluate(() => window.__cachedReopenProbe?.stop()).catch(() => {});
      });
    const ms = Date.now() - startedAt;
    console.log(`[e2e] reabertura do cache até tudo tocando: ${ms} ms`);
    expect(ms).toBeLessThan(15_000);
    expect(playing.projection.src).toBe(`louvorja://onlinevideo/${LONG}.mp4`);
    expect(externalAdOrYoutube(requests)).toEqual([]);
    await closeMedia();
  });

  test("dois cliques no mesmo vídeo viram uma projeção só", async () => {
    const [a, b] = await Promise.all([openOnline(LONG), openOnline(LONG)]);
    expect([a, b]).toEqual([true, true]);
    await until(() => windows().projection && windows().ret && windows().operator, {
      label: "janelas",
    });
    await sleep(1500);
    expect(auxiliaries().length).toBe(3);
    await closeMedia();
  });

  test("o vídeo toca até o fim e a mídia se fecha sozinha", async () => {
    const opened = await openOnline(SHORT); // baixa ~0,7 MB
    expect(opened).toBe(true);
    await until(
      async () => {
        const s = await snapshot();
        return s.projection && !s.projection.none && !s.audio.paused && s.audio.t > 0.5;
      },
      { timeout: 20_000, label: "começar a tocar" }
    );
    await media("goToTime", 15);
    await until(() => auxiliaries().length === 0, {
      timeout: 30_000,
      label: "fechar sozinho ao fim",
    });
    expect((await readAudio()).paused).toBe(true);
  });
});

test.describe("quando algo dá errado", () => {
  test.setTimeout(180_000);

  test("vídeo removido: avisa o operador e NÃO abre janela nenhuma para o telão", async () => {
    const opened = await openOnline(MISSING);
    expect(opened).toBe(false);
    await expect
      .poll(() =>
        main.evaluate(() =>
          window.__appdata.get("snackbar.show") ? window.__appdata.get("snackbar.text") : null
        )
      )
      .toMatch(/removido ou não está disponível/i);
    await sleep(1500);
    expect(auxiliaries().length).toBe(0);
  });

  test("com o download desligado e o vídeo fora do disco, volta a usar o player do YouTube", async () => {
    // Vídeo que já está baixado toca do arquivo mesmo com o download desligado (coberto
    // no bloco de Meus vídeos online); aqui o vídeo não pode estar no disco.
    await main.evaluate((id) => window.louvorjaApi.onlineVideo.remove(id), SHORT);
    await setPref("options.online_video_projection.download", false);
    try {
      const opened = await openOnline(SHORT);
      expect(opened).toBe(true);
      const proj = await until(() => windows().projection, {
        timeout: 20_000,
        label: "janela de projeção",
      });
      const frame = await until(
        async () => {
          const v = await readVideo(proj);
          return v.frames.find((f) => /youtube\.com\/embed/.test(f));
        },
        { timeout: 30_000, label: "iframe do YouTube (caminho antigo)" }
      );
      expect(frame).toMatch(new RegExp(SHORT));
    } finally {
      await closeMedia();
      await setPref("options.online_video_projection.download", true);
    }
  });

  test("binário corrompido: o download reinstala as ferramentas e o vídeo baixa", async () => {
    const ffmpeg = path.join(root, "bin", toolName("ffmpeg"));
    fs.writeFileSync(ffmpeg, Buffer.from([0, 1, 2, 3, 4, 5]), { mode: 0o755 });
    await removeFromList(SHORT);

    expect(await downloadFromList(SHORT, "Vídeo curto (E2E)")).toBe(true);
    expect(fs.statSync(ffmpeg).size).toBeGreaterThan(1_000_000);
    expect(
      (await main.evaluate(() => window.louvorjaApi.onlineVideo.list())).some((f) => f.id === SHORT)
    ).toBe(true);

    // E toca do arquivo.
    expect(await openOnline(SHORT)).toBe(true);
    await until(() => windows().projection, { timeout: 20_000, label: "projeção" });
    await closeMedia();
  });

  test("cancelar o download não abre janela, não deixa processo e apaga as trilhas pela metade", async () => {
    await removeFromList(LONG);
    const downloading = downloadFromList(LONG, "Vídeo longo (E2E)");
    await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o download começar" });
    expect((await status()).active).toContain(LONG);

    // O mesmo caminho do botão "cancelar" da lista de processos.
    await main.evaluate(
      async ([url, id]) => {
        const { useBackgroundTasks } = await import(/* @vite-ignore */ url);
        useBackgroundTasks().cancelTask(`online-video:${id}`);
      },
      [modules.tasks, LONG]
    );

    expect(await downloading).toBe(false);
    await sleep(2500);
    expect(await processesMentioning(LONG)).toEqual([]);
    expect(auxiliaries().length).toBe(0);
    expect((await status()).active).toEqual([]);
    expect((await tasks()).some((t) => t.id === `online-video:${LONG}`)).toBe(false);
    expect(fs.existsSync(streamDirOf(LONG)), "as trilhas pela metade somem").toBe(false);
  });

  test("tocar outro vídeo NÃO cancela o download que o operador pediu de propósito", async () => {
    await removeFromList(LONG);
    await removeFromList(SHORT);
    const downloading = downloadFromList(LONG, "Vídeo longo (E2E)");
    await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o download começar" });

    expect(await openOnline(SHORT)).toBe(true);
    const s = await until(
      async () => {
        const x = await snapshot();
        return x.projection && !x.projection.none && x.projection.src.includes(SHORT) ? x : null;
      },
      { timeout: 25_000, label: "o vídeo novo na projeção" }
    );
    expect(s.projection.frames).toEqual([]);

    // O download do outro seguiu e terminou, guardado.
    expect(await downloading).toBe(true);
    const list = await main.evaluate(() => window.louvorjaApi.onlineVideo.list());
    expect(list.find((f) => f.id === LONG)?.kept, "baixado de propósito").toBe(true);
    await closeMedia();
  });

  const cached = (id) =>
    main.evaluate(
      async (v) => (await window.louvorjaApi.onlineVideo.list()).some((x) => x.id === v),
      id
    );

  /**
   * Pede o vídeo e devolve enquanto o main ainda procura os links (uns 5 s, antes de as janelas
   * abrirem): é o intervalo em que trocar de ideia tem que cancelar tudo. Devolve num objeto para
   * a promessa não ser achatada.
   */
  const startOpening = async (id) => {
    await removeFromList(id);
    const opening = openOnline(id);
    await sleep(800);
    return { opening };
  };

  const playLocal = (id, title) =>
    main.evaluate(
      ([v, name]) =>
        window.__media.openAudio({
          url: `louvorja://onlinevideo/${v}.mp4`,
          title: name,
          mediaType: "video",
        }),
      [id, title]
    );

  test("parar a mídia enquanto o vídeo abre cancela tudo: ele não aparece sozinho depois", async () => {
    const { opening } = await startOpening(LONG);
    await media("close", true); // "Parar projeção"
    expect(await opening).toBe(false);
    await sleep(3000);
    expect(auxiliaries().length).toBe(0);
    expect(await processesMentioning(LONG)).toEqual([]);
    expect(await cached(LONG)).toBe(false);
    expect((await status()).active).toEqual([]);
  });

  test("abrir outra mídia enquanto o vídeo abre cancela o vídeo pendente", async () => {
    await main.evaluate(
      (v) => window.louvorjaApi.onlineVideo.ensure(v, { maxHeight: 1080 }),
      SHORT
    );
    expect(await cached(SHORT)).toBe(true);
    const { opening } = await startOpening(LONG);

    // O operador começa outra coisa (aqui, um vídeo já baixado tocando só o áudio).
    await playLocal(SHORT, "Outro");
    expect(await opening).toBe(false);
    await sleep(2500);
    expect(await processesMentioning(LONG)).toEqual([]);
    expect(await cached(LONG)).toBe(false);
    expect(auxiliaries().length).toBe(0); // o vídeo cancelado não abriu nada no telão
    await media("close", true);
  });

  test("o fim natural da mídia anterior NÃO cancela o vídeo que o operador pediu enquanto ela tocava", async () => {
    await main.evaluate(
      (v) => window.louvorjaApi.onlineVideo.ensure(v, { maxHeight: 1080 }),
      SHORT
    );
    await playLocal(SHORT, "Hino");
    await until(
      async () => {
        const a = await readAudio();
        return a.t > 0.5 && !a.paused;
      },
      { label: "o hino tocar" }
    );

    await removeFromList(LONG);
    const opening = openOnline(LONG);
    await media("goToTime", 17); // o hino de 19 s acaba enquanto o vídeo ainda abre
    await until(async () => (await readAudio()).paused, {
      timeout: 15_000,
      label: "o hino terminar",
    });

    expect(await opening).toBe(true); // o vídeo chegou e foi projetado
    const s = await until(
      async () => {
        const x = await snapshot();
        return x.projection &&
          !x.projection.none &&
          x.projection.src.includes(LONG) &&
          !x.projection.paused
          ? x
          : null;
      },
      { timeout: 25_000, label: "o vídeo na projeção depois do fim do hino" }
    );
    expect(s.projection.src).toMatch(new RegExp(`louvorja://online(stream|video)/${LONG}`));
    await closeMedia();
  });
});

/**
 * A tela que o operador usa para deixar vídeos prontos antes do culto: baixar de
 * antemão, ver o que já está no computador e apagar o que não quer mais. Tudo
 * pela interface, no Electron de verdade.
 */
test.describe("Meus vídeos online: baixar de antemão e gerenciar", () => {
  test.setTimeout(240_000);

  const NAME_SHORT = "Vídeo curto (E2E)";
  const NAME_LONG = "Vídeo longo (E2E)";
  const BTN = {
    download: "Baixar para usar sem internet",
    cancel: "Cancelar download",
    remove: "Remover download",
  };

  const card = (name) => main.locator(".cv-grid-card").filter({ hasText: name });
  const action = (name, label) => card(name).locator(`button[aria-label="${label}"]`);
  const summary = () => main.locator(".ovd-bar__summary");
  const files = () => main.evaluate(() => window.louvorjaApi.onlineVideo.list());
  const onDisk = async (id) => (await files()).find((f) => f.id === id);
  const confirmYes = () => main.getByRole("button", { name: "Sim", exact: true }).click();

  // Playwright requires a destructured fixture argument before testInfo.
  // eslint-disable-next-line no-empty-pattern
  test.beforeAll(async ({}, testInfo) => {
    await main.evaluate(() => window.louvorjaApi.onlineVideo.clear());
    await main.evaluate(
      async ([short, long, nameShort, nameLong]) => {
        const idb = (await import("/src/helpers/IndexedDB.ts")).default;
        const { DB_TABLE } = await import("/src/constants/DbTables.ts");
        const now = Date.now();
        for (const [name, id, offset] of [
          [nameShort, short, 0],
          [nameLong, long, 1],
        ]) {
          await idb.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS, {
            id: crypto.randomUUID(),
            name,
            url: `https://www.youtube.com/watch?v=${id}`,
            createdAt: new Date(now - offset).toISOString(),
          });
        }
      },
      [SHORT, LONG, NAME_SHORT, NAME_LONG]
    );
    await main.getByText("Meus Vídeos Online").first().click();
    try {
      await main.waitForSelector(".cv-grid-card", { timeout: 20_000 });
    } catch (error) {
      // Diagnóstico: o que a tela mostrava e o que o console disse, para não ficar no "às vezes falha".
      const dom = await main
        .evaluate(() => ({
          url: location.href,
          dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) =>
            (d.getAttribute("aria-label") || d.textContent || "").slice(0, 60)
          ),
          cards: document.querySelectorAll(".cv-grid-card").length,
          text: document.body.innerText.replace(/\s+/g, " ").slice(0, 600),
          bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
          modules: JSON.stringify(window.__appdata?.get?.("modules") ?? {}).slice(0, 400),
        }))
        .catch((e) => ({ erro: e.message }));
      console.log(
        "[e2e] o módulo Meus Vídeos Online não mostrou os cartões:",
        JSON.stringify(dom, null, 1)
      );
      console.log("[e2e] console da janela principal:\n" + mainConsole.slice(-25).join("\n"));
      await main
        .screenshot({ path: testInfo.outputPath("meus-videos-online-sem-cartoes.png") })
        .catch(() => {});
      throw error;
    }
  });

  test("nada baixado: cada vídeo oferece baixar, e a barra resume 0 de 2", async () => {
    await expect(action(NAME_SHORT, BTN.download)).toBeVisible();
    await expect(action(NAME_LONG, BTN.download)).toBeVisible();
    await expect(action(NAME_LONG, BTN.remove)).toHaveCount(0);
    await expect(summary()).toHaveText("Baixados: 0 de 2 (0 MB)");
    expect(auxiliaries().length).toBe(0);
  });

  test("baixar pelo botão: processo em segundo plano, arquivo mantido, e nenhuma janela de projeção", async () => {
    await action(NAME_LONG, BTN.download).click();
    await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o download começar" });
    const running = (await tasks()).find((t) => t.id === `online-video:${LONG}`);
    expect(running.label).toBe(NAME_LONG);

    await expect(card(NAME_LONG).locator(".ovd-badge .lj-chip")).toBeVisible({ timeout: 90_000 });
    console.log(
      "DEBUG-DISCO",
      JSON.stringify(await files()),
      "tarefas",
      JSON.stringify((await tasks()).map((t) => [t.id, t.status]))
    );
    await expect(action(NAME_LONG, BTN.remove)).toBeVisible();
    await expect(action(NAME_LONG, BTN.download)).toHaveCount(0);

    const file = await onDisk(LONG);
    expect(file.size).toBeGreaterThan(10 * 1024 ** 2);
    expect(file.kept, "baixado de propósito: o despejo por espaço não o leva").toBe(true);
    await expect(summary()).toHaveText(/^Baixados: 1 de 2 \(\d+ MB\)$/);
    expect((await tasks()).find((t) => t.id === `online-video:${LONG}`).status).toBe("completed");
    expect((await status()).active).toEqual([]);
    expect(auxiliaries().length, "baixar não projeta nada").toBe(0);
  });

  test("'Remover downloads' pergunta antes e só então apaga tudo o que veio da lista", async () => {
    await main.getByRole("button", { name: "Remover downloads" }).click();
    await expect(main.getByText("Remover os 1 vídeos baixados desta lista?")).toBeVisible();
    expect(await onDisk(LONG), "ainda não apagou: a pergunta vem antes").toBeTruthy();

    await confirmYes();
    await until(async () => !(await onDisk(LONG)), {
      timeout: 10_000,
      label: "o arquivo sair do disco",
    });
    await expect(action(NAME_LONG, BTN.download)).toBeVisible();
    await expect(summary()).toHaveText("Baixados: 0 de 2 (0 MB)");
  });

  // Playwright exige o primeiro argumento com destructuring de fixture, mesmo quando não é usado.
  // eslint-disable-next-line no-empty-pattern
  test("um pré-download longo não segura o vídeo que o operador projeta agora", async ({}, testInfo) => {
    const compactDownloadState = async () => {
      const [manager, disk, backgroundTasks] = await Promise.all([status(), files(), tasks()]);
      const taskState = (id) => {
        const task = backgroundTasks.find((item) => item.id === `online-video:${id}`);
        if (!task) return "absent";
        if (task.status === "running") return "running";
        if (task.status === "completed") return "completed";
        if (task.status === "error") return "error";
        return "other";
      };
      const fileState = (id) => {
        const file = disk.find((item) => item.id === id);
        return file ? (file.kept ? "kept" : "cached") : "absent";
      };
      return {
        active_count: Array.isArray(manager.active) ? manager.active.length : null,
        long: {
          active: manager.active?.includes(LONG) === true,
          task: taskState(LONG),
          file: fileState(LONG),
        },
        short: {
          active: manager.active?.includes(SHORT) === true,
          task: taskState(SHORT),
          file: fileState(SHORT),
        },
        last_stream_failure: manager.last_stream_failure ?? null,
      };
    };

    const waitForShortProjection = async () => {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        try {
          const sample = await snapshot();
          if (sample.projection && !sample.projection.none && sample.projection.src.includes(SHORT))
            return sample;
        } catch {
          /* janela ainda carregando */
        }
        await sleep(150);
      }
      throw new Error("Tempo esgotado esperando o vídeo curto na projeção");
    };

    await action(NAME_LONG, BTN.download).click();
    await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o pré-download começar" });

    const opening = openOnline(SHORT); // projetar agora, com o pré-download ainda em curso
    let shown;
    try {
      [shown] = await Promise.all([
        waitForShortProjection(),
        within(opening, 25_000, "o vídeo urgente começar").then((opened) => {
          expect(opened).toBe(true);
        }),
      ]);
    } catch (error) {
      // A CDN pode terminar o LONG antes de o SHORT abrir; só anexe estados fechados,
      // sem IDs, títulos, URLs, caminhos ou amostras por chunk/frame.
      await testInfo
        .attach("concurrent-download-state", {
          body: JSON.stringify(await compactDownloadState().catch(() => ({ unavailable: true }))),
          contentType: "application/json",
        })
        .catch(() => {});
      throw error;
    }
    expect(shown.projection.frames).toEqual([]);

    await until(async () => (await onDisk(LONG))?.kept === true, {
      timeout: 120_000,
      label: "o pré-download terminar",
    });
    expect((await onDisk(SHORT)).kept, "só projetar não fixa o vídeo").toBe(false);
    await expect(action(NAME_LONG, BTN.remove)).toBeVisible();
    await closeMedia();
  });

  test("projetar um vídeo da lista o guarda: ele não some quando o cache automático encher", async () => {
    expect((await onDisk(SHORT)).kept).toBe(false);
    await card(NAME_SHORT).locator(".cv-grid-thumb").click();
    await until(() => windows().projection, { timeout: 25_000, label: "a projeção" });
    await until(async () => (await onDisk(SHORT))?.kept === true, {
      timeout: 10_000,
      label: "o vídeo ser guardado",
    });
    await expect(action(NAME_SHORT, BTN.remove)).toBeVisible();
    await closeMedia();
  });

  test("com o download automático desligado, o vídeo já baixado ainda toca do arquivo", async () => {
    await setPref("options.online_video_projection.download", false);
    try {
      await card(NAME_LONG).locator(".cv-grid-thumb").click();
      const s = await until(
        async () => {
          const x = await snapshot();
          return x.projection &&
            !x.projection.none &&
            x.projection.src.includes(LONG) &&
            !x.projection.paused
            ? x
            : null;
        },
        { timeout: 25_000, label: "o vídeo baixado na projeção" }
      );
      expect(s.projection.src).toBe(`louvorja://onlinevideo/${LONG}.mp4`);
      expect(s.projection.frames, "sem player do YouTube, logo sem anúncio").toEqual([]);
      await closeMedia();
    } finally {
      await setPref("options.online_video_projection.download", true);
    }
  });

  test("remover um download pelo cartão: pergunta, apaga só aquele, e o vídeo segue na lista", async () => {
    await action(NAME_LONG, BTN.remove).click();
    expect(await onDisk(LONG), "a pergunta vem antes de apagar").toBeTruthy();
    await confirmYes();
    await until(async () => !(await onDisk(LONG)), {
      timeout: 10_000,
      label: "o arquivo sair do disco",
    });
    await expect(action(NAME_LONG, BTN.download)).toBeVisible();
    await expect(card(NAME_LONG)).toHaveCount(1);
    expect(await onDisk(SHORT), "o outro download não foi tocado").toBeTruthy();
  });

  test("cancelar pelo cartão: para o download, não deixa processo e devolve o botão de baixar", async () => {
    await action(NAME_LONG, BTN.download).click();
    await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o download começar" });
    expect((await status()).active).toContain(LONG);

    await action(NAME_LONG, BTN.cancel).click();
    await expect(action(NAME_LONG, BTN.download)).toBeVisible({ timeout: 10_000 });
    await sleep(2500);
    expect(await processesMentioning(LONG)).toEqual([]);
    expect((await status()).active).toEqual([]);
    expect((await tasks()).some((t) => t.id === `online-video:${LONG}`)).toBe(false);
    expect(await onDisk(LONG)).toBeFalsy();
    expect(fs.existsSync(streamDirOf(LONG)), "as trilhas pela metade somem").toBe(false);
  });

  test("pelo cartão, toca já, mostra o estado do download e cancela se ainda estiver baixando", async () => {
    const STREAM_LONG = `louvorja://onlinestream/${LONG}/video`;
    const playingFromStream = () =>
      until(
        async () => {
          const x = await snapshot();
          return [x.projection, x.ret, x.operator].every(
            (v) => v && !v.none && v.src === STREAM_LONG && v.ready >= 3 && v.t > 0.3
          )
            ? x
            : null;
        },
        { timeout: 40_000, label: "o vídeo tocando pelo cartão, antes de acabar de baixar" }
      );

    await removeFromList(LONG);
    await card(NAME_LONG).locator(".cv-grid-thumb").click();
    await playingFromStream();

    // A transferência pode terminar enquanto as três janelas começam a reproduzir.
    const badge = card(NAME_LONG).locator(".ovd-badge");
    await expect(badge).toHaveClass(/ovd-badge--(downloading|downloaded)/);
    await expect(action(NAME_LONG, BTN.download)).toHaveCount(0);

    const badgeState = await badge.evaluate((el) => {
      if (el.classList.contains("ovd-badge--downloaded")) return "downloaded";
      return el.classList.contains("ovd-badge--downloading") &&
        el.querySelector('[role="progressbar"]')
        ? "downloading"
        : "missing-progress";
    });
    expect(["downloading", "downloaded"]).toContain(badgeState);

    let cancelled = false;
    if (badgeState === "downloading") {
      // Cancelar o download leva o vídeo junto: as trilhas de onde ele toca somem.
      try {
        await action(NAME_LONG, BTN.cancel).click({ timeout: 1500 });
        cancelled = true;
      } catch (error) {
        // O botão some se o download terminar entre a leitura do selo e o clique.
        if (!(await onDisk(LONG))) throw error;
      }
    }

    if (cancelled) {
      await expect(action(NAME_LONG, BTN.download)).toBeVisible({ timeout: 5_000 });
      await until(() => auxiliaries().length === 0, {
        timeout: 10_000,
        label: "o vídeo parar junto com o download",
      });
      await sleep(1500);
      expect((await status()).active).toEqual([]);
      expect(fs.existsSync(streamDirOf(LONG)), "as trilhas pela metade somem").toBe(false);
      expect(await onDisk(LONG)).toBeFalsy();

      // Clicar de novo logo em seguida tem que funcionar (não pode pegar carona no cancelado).
      await card(NAME_LONG).locator(".cv-grid-thumb").click();
      await playingFromStream();
      await closeMedia();
      await until(async () => !!(await onDisk(LONG)), {
        timeout: 180_000,
        label: "o vídeo chegar ao disco",
      });
    } else {
      await expect(action(NAME_LONG, BTN.remove)).toBeVisible();
      expect(
        await onDisk(LONG),
        "o selo de concluído corresponde ao arquivo no disco"
      ).toBeTruthy();
      await closeMedia();
    }

    // Limpa pela própria tela, para o cartão e o disco seguirem de acordo.
    await expect(action(NAME_LONG, BTN.remove)).toBeVisible({ timeout: 10_000 });
    await action(NAME_LONG, BTN.remove).click();
    await confirmYes();
    await until(async () => !(await onDisk(LONG)), {
      timeout: 10_000,
      label: "o arquivo sair do disco",
    });
    await expect(action(NAME_LONG, BTN.download)).toBeVisible();
  });

  /**
   * "Tocar já": sem o arquivo no disco, o vídeo começa antes de acabar de baixar. O main
   * baixa UMA vez, aos pedaços, para um arquivo que vai crescendo, e todas as telas leem
   * dele pelo protocolo do app — sem uma conexão por janela (o YouTube limita cada uma a
   * ~2× o tempo real, e as imagens travavam) e sem o player do YouTube (sem anúncio).
   */
  test.describe("tocar já: o vídeo começa antes de acabar de baixar", () => {
    const STREAM = (id, kind) => `louvorja://onlinestream/${id}/${kind}`;
    const removeFromDisk = (id) =>
      main.evaluate((v) => window.louvorjaApi.onlineVideo.remove(v), id);

    test.afterAll(async () => {
      await removeFromDisk(LONG);
    });

    /** As telas que mostram imagem (a do player do app só aparece com o diálogo aberto). */
    const screens = (s) => [s.projection, s.ret, s.operator];

    test("abre em segundos e as três telas leem do mesmo arquivo em crescimento, sem o YouTube no meio", async () => {
      await removeFromDisk(LONG);
      const before = requests.length;
      const startedAt = Date.now();
      const opened = await openOnline(LONG);
      const elapsed = Date.now() - startedAt;
      expect(opened).toBe(true);
      console.log(`[e2e] tocar já: pronto para tocar em ${(elapsed / 1000).toFixed(1)} s`);
      expect(elapsed, "não esperou o download inteiro").toBeLessThan(25_000);

      let lastPlaybackSnapshot = null;
      const playing = await until(
        async () => {
          const s = await snapshot();
          lastPlaybackSnapshot = s;
          return screens(s).every(
            (v) => v && !v.none && v.src === STREAM(LONG, "video") && v.ready >= 3 && v.t > 0.3
          )
            ? s
            : null;
        },
        { timeout: 20_000, label: "as três telas tocando do arquivo em crescimento" }
      ).catch(async (error) => {
        const manager = await status().catch(() => null);
        await test.info().attach("stream-readiness-numeric", {
          body: Buffer.from(
            JSON.stringify(
              {
                projection: diagnosticMedia(lastPlaybackSnapshot?.projection),
                return: diagnosticMedia(lastPlaybackSnapshot?.ret),
                operator: diagnosticMedia(lastPlaybackSnapshot?.operator),
                audio: diagnosticMedia(lastPlaybackSnapshot?.audio),
                manager: manager
                  ? {
                      ready: manager.ready,
                      activeCount: Array.isArray(manager.active) ? manager.active.length : null,
                      last_stream_failure: manager.last_stream_failure ?? null,
                    }
                  : null,
              },
              null,
              2
            )
          ),
          contentType: "application/json",
        });
        throw error;
      });
      for (const v of screens(playing)) {
        expect(v.frames, "nenhum player do YouTube").toEqual([]);
        expect(v.muted).toBe(true);
      }
      expect(playing.audio.src).toBe(STREAM(LONG, "audio"));
      expect(playing.audio.paused).toBe(false);

      // Quem fala com o YouTube é o main (uma vez): nenhuma janela abre conexão própria.
      const fromWindows = requests
        .slice(before)
        .filter(
          (r) =>
            /googlevideo\.com/i.test(r.url) || (r.page !== "/" && externalAdOrYoutube([r]).length)
        );
      expect(fromWindows.map((r) => `${r.page} ${r.url}`)).toEqual([]);

      // Imagem e som alinhados enquanto ainda baixa.
      const gaps = [];
      const driftSamples = [];
      // Explicit whitelist: never attach the snapshot's URLs, iframe sources,
      // titles or filesystem paths. Timestamps are captured inside each
      // renderer's read, so delayed evaluation is distinguishable from drift.
      const timing = (media) => ({
        sampledAtMs: media.sampledAtMs,
        currentTime: media.t,
        playbackRate: media.playbackRate,
        readyState: media.ready,
        paused: media.paused,
      });
      for (let i = 0; i < 8; i++) {
        await sleep(500);
        const s = await snapshot();
        for (const v of screens(s)) gaps.push(v.t - s.audio.t);
        const roleSample = (video) => ({
          ...timing(video),
          signedDriftSeconds: video.t - s.audio.t,
        });
        driftSamples.push({
          sample: i,
          audio: timing(s.audio),
          projection: roleSample(s.projection),
          return: roleSample(s.ret),
          operator: roleSample(s.operator),
        });
      }
      const medianDriftSeconds = median(gaps.map(Math.abs));
      const maxDriftSeconds = Math.max(...gaps.map(Math.abs));
      console.log(
        `[e2e] tocar já: deriva imagem-som mediana ${(medianDriftSeconds * 1000).toFixed(0)} ms, pior ${(maxDriftSeconds * 1000).toFixed(0)} ms`
      );
      if (medianDriftSeconds >= 0.15 || maxDriftSeconds >= 0.5) {
        await test.info().attach("stream-drift-numeric", {
          body: Buffer.from(
            JSON.stringify({ medianDriftSeconds, maxDriftSeconds, samples: driftSamples }, null, 2)
          ),
          contentType: "application/json",
        });
      }
      expect(medianDriftSeconds).toBeLessThan(0.15);
      expect(maxDriftSeconds).toBeLessThan(0.5);

      // O download foi este mesmo: aparece na lista de processos, termina no disco e não guarda.
      await until(async () => !!(await onDisk(LONG)), {
        timeout: 120_000,
        label: "o vídeo chegar ao disco",
      });
      const file = await onDisk(LONG);
      expect(file.kept, "download automático: só cache").toBe(false);
      expect(file.size).toBeGreaterThan(50_000_000);
      expect((await status()).active).toEqual([]);
      expect((await snackbar()) ?? "").not.toMatch(/Não foi possível/);
      expect(await processesMentioning(LONG), "o yt-dlp não baixa de novo").toEqual([]);

      // Acabar de baixar não troca o que está no ar.
      await sleep(1_500);
      const still = await snapshot();
      expect(screens(still).every((v) => v.src === STREAM(LONG, "video") && !v.paused)).toBe(true);
      expect(still.audio.t).toBeGreaterThan(playing.audio.t);
      await closeMedia();

      // Da próxima vez toca do arquivo, sem trilhas separadas.
      expect(await openOnline(LONG)).toBe(true);
      const local = await until(
        async () => {
          const x = await snapshot();
          return x.projection &&
            !x.projection.none &&
            x.projection.src.includes(LONG) &&
            !x.projection.paused
            ? x
            : null;
        },
        { timeout: 30_000, label: "o vídeo do arquivo" }
      );
      expect(local.projection.src).toBe(`louvorja://onlinevideo/${LONG}.mp4`);
      expect(local.audio.src).toBe(`louvorja://onlinevideo/${LONG}.mp4`);
      await closeMedia();
    });

    test("pelo cartão de Meus vídeos online: toca já, o cartão mostra o andamento e o vídeo fica guardado", async () => {
      await removeFromDisk(LONG);
      const startedAt = Date.now();
      await card(NAME_LONG).locator(".cv-grid-thumb").click();
      await until(
        async () => {
          const s = await snapshot();
          return screens(s).every(
            (v) => v && !v.none && v.src === STREAM(LONG, "video") && v.ready >= 3 && v.t > 0.3
          )
            ? s
            : null;
        },
        { timeout: 40_000, label: "as telas tocando pelo cartão, antes de acabar de baixar" }
      );
      expect(Date.now() - startedAt, "não esperou o download inteiro").toBeLessThan(30_000);

      // Baixando ao fundo, o cartão mostra o andamento em vez de oferecer o download.
      const stillDownloading = !(await onDisk(LONG));
      if (stillDownloading) {
        await expect(card(NAME_LONG).locator('.ovd-badge [role="progressbar"]')).toBeVisible();
        await expect(action(NAME_LONG, BTN.download)).toHaveCount(0);
      }

      // Vídeo da própria lista fica guardado: o despejo do cache automático não o leva.
      await until(async () => !!(await onDisk(LONG)), {
        timeout: 180_000,
        label: "o vídeo chegar ao disco",
      });
      await until(async () => (await onDisk(LONG))?.kept === true, {
        timeout: 10_000,
        label: "o vídeo da lista ser guardado",
      });
      await closeMedia();

      await expect(action(NAME_LONG, BTN.remove)).toBeVisible({ timeout: 10_000 });
      await action(NAME_LONG, BTN.remove).click();
      await confirmYes();
      await until(async () => !(await onDisk(LONG)), {
        timeout: 10_000,
        label: "o arquivo sair do disco",
      });
    });

    test("mandar tocar no meio do download de antemão: entra nele, sem esperar e sem baixar de novo", async () => {
      await removeFromList(LONG);
      await action(NAME_LONG, BTN.download).click();
      await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o download começar" });

      const before = requests.length;
      const startedAt = Date.now();
      await card(NAME_LONG).locator(".cv-grid-thumb").click();
      await until(
        async () => {
          const s = await snapshot();
          return screens(s).every(
            (v) => v && !v.none && v.src === STREAM(LONG, "video") && v.ready >= 3 && v.t > 0.3
          )
            ? s
            : null;
        },
        { timeout: 30_000, label: "as telas tocando do download em curso" }
      );
      expect(Date.now() - startedAt, "não esperou o download terminar").toBeLessThan(25_000);

      // Um download só: nenhuma janela falou com o YouTube.
      const fromWindows = requests
        .slice(before)
        .filter(
          (r) =>
            /googlevideo\.com/i.test(r.url) || (r.page !== "/" && externalAdOrYoutube([r]).length)
        );
      expect(fromWindows.map((r) => `${r.page} ${r.url}`)).toEqual([]);

      await until(async () => (await onDisk(LONG))?.kept === true, {
        timeout: 180_000,
        label: "o download terminar, guardado",
      });
      await closeMedia();
    });

    test("pausar, saltar e retomar chegam às três telas, sem esperar o download", async () => {
      await removeFromDisk(LONG);
      expect(await openOnline(LONG)).toBe(true);
      await until(
        async () => screens(await snapshot()).every((v) => v && v.ready >= 3 && v.t > 0.3),
        {
          timeout: 20_000,
          label: "tocando",
        }
      );

      await media("pause", true);
      await until(
        async () => {
          const s = await snapshot();
          return screens(s).every((v) => v.paused) && s.audio.paused;
        },
        { timeout: 4_000, label: "todas pausarem" }
      );

      const askedAt = Date.now();
      await media("goToTime", 150);
      await until(
        async () => {
          const s = await snapshot();
          return (
            screens(s).every((v) => v.ready >= 3 && Math.abs(v.t - 150) < 2) &&
            Math.abs(s.audio.t - 150) < 2
          );
        },
        { timeout: 8_000, label: "todas irem para 2:30" }
      );
      console.log(`[e2e] tocar já: salto para 2:30 em ${Date.now() - askedAt} ms`);

      await media("pause", false);
      await until(
        async () => {
          const s = await snapshot();
          return screens(s).every((v) => !v.paused && v.t > 150.5) && !s.audio.paused;
        },
        { timeout: 8_000, label: "todas retomarem" }
      );
      await closeMedia();
    });

    test("fechar a mídia com o download em curso não o cancela: o vídeo chega ao disco para a próxima vez", async () => {
      await removeFromDisk(LONG);
      expect(await openOnline(LONG)).toBe(true);
      await closeMedia();
      await until(async () => !!(await onDisk(LONG)), {
        timeout: 120_000,
        label: "o vídeo chegar ao disco",
      });
      expect((await onDisk(LONG)).kept).toBe(false);
      expect((await snackbar()) ?? "").not.toMatch(/Não foi possível/);
      expect(auxiliaries().length).toBe(0);
    });

    test("apertar play em um vídeo e depois em outro: só o segundo fica no telão, e os dois acabam baixados", async () => {
      await removeFromDisk(LONG);
      await removeFromDisk(SHORT);

      expect(await openOnline(LONG)).toBe(true);
      await until(async () => (await snapshot()).projection?.src === STREAM(LONG, "video"), {
        timeout: 20_000,
        label: "o primeiro no telão",
      });

      expect(await openOnline(SHORT)).toBe(true);
      const second = await until(
        async () => {
          const s = await snapshot();
          return screens(s).every((v) => v && v.src === STREAM(SHORT, "video") && v.ready >= 3) &&
            s.audio.src === STREAM(SHORT, "audio")
            ? s
            : null;
        },
        { timeout: 20_000, label: "o segundo no telão" }
      );
      expect(second.projection.frames).toEqual([]);
      expect(windows().all.filter((w) => route(w) === "/projection/file")).toHaveLength(1);

      // O primeiro seguiu baixando ao fundo (é o que o operador pediu, e a próxima vez sai do arquivo).
      await until(async () => !!(await onDisk(LONG)) && !!(await onDisk(SHORT)), {
        timeout: 120_000,
        label: "os dois chegarem ao disco",
      });
      await closeMedia();
    });

    test("com o yt-dlp quebrado: cai no player do YouTube (avisando), e o download ao fundo renova o yt-dlp", async () => {
      const ytdlp = path.join(root, "bin", toolName("yt-dlp"));
      await removeFromDisk(LONG);
      if (nodeProcess.platform === "win32") {
        // Um PE inválido produz a mesma categoria de erro de ferramenta e força
        // o caminho real de reset/reinstalação, sem depender de bash no Windows.
        fs.writeFileSync(ytdlp, Buffer.from([0, 1, 2, 3, 4, 5]));
      } else {
        fs.writeFileSync(
          ytdlp,
          '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 2020.01.01; exit 0; fi\n' +
            "echo 'ERROR: algo que só uma versão nova entende' >&2\nexit 1\n",
          { mode: 0o755 }
        );
      }

      const opened = await openOnline(LONG);
      expect(opened).toBe(true);
      const proj = await until(() => windows().projection, {
        timeout: 20_000,
        label: "janela de projeção",
      });
      const frame = await until(
        async () => (await readVideo(proj)).frames.find((f) => /youtube\.com\/embed/.test(f)),
        { timeout: 30_000, label: "o player do YouTube (reserva)" }
      );
      expect(frame).toMatch(new RegExp(LONG));
      expect(await snackbar()).toMatch(/player do YouTube/);

      // A reserva não fica sem o download: ele renova o yt-dlp e o vídeo chega ao disco.
      await until(async () => !!(await onDisk(LONG)), {
        timeout: 150_000,
        label: "o vídeo chegar ao disco",
      });
      expect(fs.statSync(ytdlp).size, "voltou o yt-dlp de verdade").toBeGreaterThan(1_000_000);
      await closeMedia();
    });
  });

  test("excluir o vídeo da lista leva junto o arquivo baixado, e avisa disso", async () => {
    expect(await onDisk(SHORT)).toBeTruthy();
    await main.evaluate(() => {
      window.__confirmMessages = [];
      window.confirm = (message) => (window.__confirmMessages.push(message), true);
    });
    await action(NAME_SHORT, "Excluir").click();
    await until(async () => !(await onDisk(SHORT)), {
      timeout: 10_000,
      label: "o arquivo sair do disco",
    });
    await expect(card(NAME_SHORT)).toHaveCount(0);
    expect(await main.evaluate(() => window.__confirmMessages)).toEqual([
      "Excluir este vídeo? O arquivo baixado no computador também será apagado.",
    ]);
  });

  // Por último: cria um cartão a mais na lista.
  test("link novo na lista: o download já começa sozinho e o vídeo fica guardado, sem projetar nada", async () => {
    await removeFromList(SHORT);
    await main.getByRole("button", { name: "Adicionar vídeo" }).first().click();
    const dialog = main.getByRole("dialog").last();
    await dialog.locator("input").first().fill(`https://www.youtube.com/watch?v=${SHORT}`);
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click();

    await until(async () => (await onDisk(SHORT))?.kept === true, {
      timeout: 120_000,
      label: "o vídeo do link novo ser baixado e guardado, sem ninguém apertar baixar",
    });
    expect(auxiliaries().length, "baixar não projeta nada").toBe(0);
  });
});
