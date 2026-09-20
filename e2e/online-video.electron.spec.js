/**
 * Vídeo online no Electron de verdade: o yt-dlp e o ffmpeg reais baixam um
 * vídeo real do YouTube e o app o projeta como arquivo local, em projeção,
 * retorno e operador, sem nenhum player do YouTube (logo, sem anúncio).
 *
 * Rode com o Vite no ar (porta 5002) e internet:
 *   VITE_TARGET=desktop npx vite --port 5002 --strictPort
 *   LJ_RUN_ELECTRON_ONLINE_VIDEO=1 npx playwright test e2e/online-video.electron.spec.js \
 *     --reporter=line
 *
 * É opt-in: baixa ~130 MB na primeira vez e abre janelas de verdade na tela.
 * Usa um perfil isolado (LJ_E2E_USER_DATA), então convive com o app do usuário.
 */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeProcess from "node:process";
import { execFileSync } from "node:child_process";

test.skip(
  !nodeProcess.env.LJ_RUN_ELECTRON_ONLINE_VIDEO || nodeProcess.platform === "win32",
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

let app;
let main;
let root;
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
          t: v.currentTime,
          paused: v.paused,
          muted: v.muted,
          w: v.videoWidth,
          h: v.videoHeight,
          src: v.currentSrc,
          ready: v.readyState,
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
      t: el.currentTime,
      paused: el.paused,
      muted: el.muted,
      volume: el.volume,
      src: el.currentSrc,
      dur: el.duration,
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

const openOnline = (id) =>
  main.evaluate(([url]) => window.__media.openYouTube(url, "Teste E2E"), [embed(id)]);

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

function processesMentioning(needle) {
  try {
    const out = execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" });
    return out
      .split("\n")
      .filter((l) => l.includes(needle) && !l.includes("playwright") && !l.includes("ps -axo"));
  } catch {
    return [];
  }
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
  if (app) {
    try {
      nodeProcess.kill(app.process().pid, "SIGKILL");
    } catch {
      /* já saiu */
    }
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test.describe("primeiro uso: instala as ferramentas e baixa um 1080p", () => {
  test.setTimeout(420_000);

  test("mostra o progresso, projeta nas três janelas e não usa o player do YouTube", async () => {
    expect((await status()).ready).toBe(false);
    const startedAt = Date.now();
    requests.length = 0;

    const opening = openOnline(LONG);

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
      const done = await Promise.race([opening.then(() => true), sleep(700).then(() => false)]);
      if (done) break;
    }
    const opened = await opening;
    const elapsed = Date.now() - startedAt;
    console.log(
      `[e2e] primeira abertura (com instalação das ferramentas): ${(elapsed / 1000).toFixed(1)} s`
    );

    expect(opened).toBe(true);
    expect(sawTools, "deve ter avisado que prepara as ferramentas na primeira vez").toBe(true);
    expect(seen.length).toBeGreaterThan(3);
    expect(Math.max(...seen)).toBeGreaterThan(50);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] - 1);
    expect((await status()).ready).toBe(true);
    expect((await status()).count).toBe(1);

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
    expect(processesMentioning(LONG)).toEqual([]);
    expect((await status()).count).toBe(1); // o arquivo continua no cache
  });
});

test.describe("depois de baixado", () => {
  test.setTimeout(120_000);

  test("reabrir vem do cache: rápido, sem tarefa de download e sem rede do YouTube", async () => {
    requests.length = 0;
    const startedAt = Date.now();
    const opened = await openOnline(LONG);
    expect(opened).toBe(true);
    expect(
      (await tasks()).some((t) => t.id === `online-video:${LONG}` && t.status === "running")
    ).toBe(false);

    const playing = await until(
      async () => {
        const s = await snapshot();
        return [s.projection, s.ret, s.operator].every(
          (v) => v && !v.none && !v.paused && v.t > 0.3
        ) && !s.audio.paused
          ? s
          : null;
      },
      { timeout: 20_000, label: "as três janelas tocando" }
    );
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
    expect(await snackbar()).toMatch(/removido ou não está disponível/i);
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

  test("yt-dlp desatualizado: renova sozinho e o vídeo abre", async () => {
    const ytdlp = path.join(root, "bin", "yt-dlp");
    const ffmpeg = path.join(root, "bin", "ffmpeg");
    const ffmpegBefore = fs.statSync(ffmpeg).mtimeMs;
    // Um yt-dlp "antigo": responde --version normalmente e só falha ao baixar, como um
    // extrator que o YouTube deixou para trás. Os dois binários seguem executando.
    fs.writeFileSync(
      ytdlp,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 2020.01.01; exit 0; fi\n' +
        "echo 'ERROR: algo que só uma versão nova entende' >&2\nexit 1\n",
      { mode: 0o755 }
    );
    await main.evaluate(() => window.louvorjaApi.onlineVideo.remove("jNQXAC9IVRw"));

    const opened = await openOnline(SHORT);
    expect(opened).toBe(true);
    expect(fs.statSync(ytdlp).size, "voltou o yt-dlp de verdade").toBeGreaterThan(1_000_000);
    expect(fs.statSync(ffmpeg).mtimeMs, "só o yt-dlp foi trocado; o ffmpeg ficou como estava").toBe(
      ffmpegBefore
    );
    await until(
      async () => {
        const s = await snapshot();
        return s.projection && !s.projection.none && s.projection.src.includes(SHORT);
      },
      { timeout: 20_000, label: "o vídeo baixado na projeção" }
    );
    await closeMedia();
  });

  test("binário corrompido: reinstala as ferramentas e o vídeo abre", async () => {
    const ffmpeg = path.join(root, "bin", "ffmpeg");
    fs.writeFileSync(ffmpeg, Buffer.from([0, 1, 2, 3, 4, 5]), { mode: 0o755 });
    await main.evaluate(() => window.louvorjaApi.onlineVideo.remove("jNQXAC9IVRw"));

    const opened = await openOnline(SHORT);
    expect(opened).toBe(true);
    expect(fs.statSync(ffmpeg).size).toBeGreaterThan(1_000_000);
    await until(() => windows().projection, { timeout: 20_000, label: "projeção" });
    await closeMedia();
  });

  test("cancelar durante o download não abre janela e não deixa processo", async () => {
    await main.evaluate((id) => window.louvorjaApi.onlineVideo.remove(id), LONG);
    const opening = openOnline(LONG);
    await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o download começar" });
    const running = processesMentioning(LONG);
    expect(running.length).toBeGreaterThan(0);
    // O yt-dlp usa o próprio Electron (como Node) para resolver o desafio de JS do YouTube.
    expect(running.some((l) => l.includes("--js-runtimes node:"))).toBe(true);

    // O mesmo caminho do botão "cancelar" da lista de processos.
    await main.evaluate(
      async ([url, id]) => {
        const { useBackgroundTasks } = await import(/* @vite-ignore */ url);
        useBackgroundTasks().cancelTask(`online-video:${id}`);
      },
      [modules.tasks, LONG]
    );

    expect(await opening).toBe(false);
    await sleep(2500);
    expect(processesMentioning(LONG)).toEqual([]);
    expect(auxiliaries().length).toBe(0);
    expect((await status()).active).toEqual([]);
    expect((await tasks()).some((t) => t.id === `online-video:${LONG}`)).toBe(false);
  });

  test("pedir outro vídeo cancela o que ainda baixava e toca o novo", async () => {
    await main.evaluate((id) => window.louvorjaApi.onlineVideo.remove(id), LONG);
    await main.evaluate((id) => window.louvorjaApi.onlineVideo.remove(id), SHORT);
    const first = openOnline(LONG);
    await until(() => downloadingTask(LONG), {
      timeout: 60_000,
      label: "o primeiro download começar",
    });

    const second = await openOnline(SHORT);
    expect(second).toBe(true);
    expect(await first).toBe(false);

    const s = await until(
      async () => {
        const x = await snapshot();
        return x.projection && !x.projection.none && x.projection.src.includes(SHORT) ? x : null;
      },
      { timeout: 20_000, label: "o vídeo novo na projeção" }
    );
    expect(s.projection.src).toBe(`louvorja://onlinevideo/${SHORT}.mp4`);
    await sleep(2000);
    expect(processesMentioning(LONG)).toEqual([]);
    await closeMedia();
  });

  const cached = (id) =>
    main.evaluate(
      async (v) => (await window.louvorjaApi.onlineVideo.list()).some((x) => x.id === v),
      id
    );

  /** Pede o vídeo e espera o download engrenar. Devolve num objeto para a promessa não ser achatada. */
  const startDownloading = async (id) => {
    await main.evaluate((v) => window.louvorjaApi.onlineVideo.remove(v), id);
    const opening = openOnline(id);
    await until(() => downloadingTask(id), { timeout: 60_000, label: "o download começar" });
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

  test("parar a mídia durante o download cancela o vídeo: ele não aparece sozinho depois", async () => {
    const { opening } = await startDownloading(LONG);
    await media("close", true); // "Parar projeção"
    expect(await opening).toBe(false);
    await sleep(3000);
    expect(auxiliaries().length).toBe(0);
    expect(processesMentioning(LONG)).toEqual([]);
    expect(await cached(LONG)).toBe(false);
  });

  test("abrir outra mídia durante o download cancela o vídeo pendente", async () => {
    await main.evaluate(
      (v) => window.louvorjaApi.onlineVideo.ensure(v, { maxHeight: 1080 }),
      SHORT
    );
    expect(await cached(SHORT)).toBe(true);
    const { opening } = await startDownloading(LONG);

    // O operador começa outra coisa (aqui, um vídeo já baixado tocando só o áudio).
    await playLocal(SHORT, "Outro");
    expect(await opening).toBe(false);
    await sleep(2500);
    expect(processesMentioning(LONG)).toEqual([]);
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

    const { opening } = await startDownloading(LONG);
    await media("goToTime", 17); // o hino de 19 s acaba enquanto o vídeo ainda baixa
    await until(async () => (await readAudio()).paused, {
      timeout: 15_000,
      label: "o hino terminar",
    });
    expect(
      (await tasks()).some((t) => t.id === `online-video:${LONG}` && t.status === "running")
    ).toBe(true);

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
    expect(s.projection.src).toBe(`louvorja://onlinevideo/${LONG}.mp4`);
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

  test.beforeAll(async () => {
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
    await main.waitForSelector(".cv-grid-card", { timeout: 20_000 });
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

  test("um pré-download longo não segura o vídeo que o operador projeta agora", async () => {
    await action(NAME_LONG, BTN.download).click();
    await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o pré-download começar" });

    const opening = openOnline(SHORT); // projetar agora, com o pré-download ainda em curso
    await until(
      async () => {
        const { active } = await status();
        return active.includes(LONG) && active.includes(SHORT);
      },
      { timeout: 30_000, interval: 100, label: "os dois vídeos baixando ao mesmo tempo" }
    );

    expect(await opening).toBe(true);
    const shown = await until(
      async () => {
        const x = await snapshot();
        return x.projection && !x.projection.none && x.projection.src.includes(SHORT) ? x : null;
      },
      { timeout: 25_000, label: "o vídeo curto na projeção" }
    );
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
    expect(processesMentioning(LONG).length).toBeGreaterThan(0);

    await action(NAME_LONG, BTN.cancel).click();
    await expect(action(NAME_LONG, BTN.download)).toBeVisible({ timeout: 10_000 });
    await sleep(2500);
    expect(processesMentioning(LONG)).toEqual([]);
    expect((await status()).active).toEqual([]);
    expect((await tasks()).some((t) => t.id === `online-video:${LONG}`)).toBe(false);
    expect(await onDisk(LONG)).toBeFalsy();
  });

  test("projetar pelo cartão um vídeo ainda não baixado: o cartão mostra o andamento, e o ✕ cancela na hora", async () => {
    await main.evaluate((id) => window.louvorjaApi.onlineVideo.remove(id), LONG);
    await card(NAME_LONG).locator(".cv-grid-thumb").click();
    await until(() => downloadingTask(LONG), { timeout: 60_000, label: "o download começar" });

    // O cartão não finge que nada acontece: mostra a barra e oferece cancelar, não baixar.
    await expect(card(NAME_LONG).locator('.ovd-badge [role="progressbar"]')).toBeVisible();
    await expect(action(NAME_LONG, BTN.download)).toHaveCount(0);
    expect(auxiliaries().length, "ainda baixando: nada no telão").toBe(0);

    await action(NAME_LONG, BTN.cancel).click();
    await expect(action(NAME_LONG, BTN.download)).toBeVisible({ timeout: 5_000 }); // sem esperar o yt-dlp sair
    await expect(card(NAME_LONG).locator(".cv-grid-card--active, .ovd-badge")).toHaveCount(0);

    // Clicar de novo logo em seguida tem que funcionar (não pode pegar carona no cancelado).
    await card(NAME_LONG).locator(".cv-grid-thumb").click();
    const shown = await until(
      async () => {
        const x = await snapshot();
        return x.projection &&
          !x.projection.none &&
          x.projection.src.includes(LONG) &&
          !x.projection.paused
          ? x
          : null;
      },
      { timeout: 120_000, label: "o vídeo na projeção depois de cancelar e tocar de novo" }
    );
    expect(shown.projection.src).toBe(`louvorja://onlinevideo/${LONG}.mp4`);
    await expect(action(NAME_LONG, BTN.remove)).toBeVisible();
    await closeMedia();
    // Limpa pela própria tela, para o cartão e o disco seguirem de acordo.
    await action(NAME_LONG, BTN.remove).click();
    await confirmYes();
    await until(async () => !(await onDisk(LONG)), {
      timeout: 10_000,
      label: "o arquivo sair do disco",
    });
    await expect(action(NAME_LONG, BTN.download)).toBeVisible();
  });

  test("tocar já enquanto baixa: o player do YouTube abre na hora, e o download segue ao fundo sem trocar nada", async () => {
    await main.evaluate((id) => window.louvorjaApi.onlineVideo.remove(id), LONG);
    await setPref("options.online_video_projection.play_while_downloading", true);
    try {
      const startedAt = Date.now();
      const opened = await openOnline(LONG);
      expect(opened).toBe(true);
      expect(Date.now() - startedAt, "não esperou o download").toBeLessThan(6_000);

      const proj = await until(() => windows().projection, {
        timeout: 20_000,
        label: "janela de projeção",
      });
      const frame = await until(
        async () => (await readVideo(proj)).frames.find((f) => /youtube\.com\/embed/.test(f)),
        { timeout: 30_000, label: "o player do YouTube" }
      );
      expect(frame).toMatch(new RegExp(LONG));

      // O download corre ao fundo: aparece na lista de processos e termina no disco, sem guardar.
      await until(() => downloadingTask(LONG), {
        timeout: 60_000,
        label: "o download em segundo plano",
      });
      await until(async () => !!(await onDisk(LONG)), {
        timeout: 120_000,
        label: "o vídeo chegar ao disco",
      });
      expect((await onDisk(LONG)).kept, "download automático: só cache").toBe(false);
      expect((await snackbar()) ?? "").not.toMatch(/Não foi possível baixar/);

      // Acabar de baixar não troca o que está no ar: segue o player do YouTube.
      await sleep(2_500);
      const still = await readVideo(proj);
      expect(still.frames.some((f) => /youtube\.com\/embed/.test(f))).toBe(true);
      expect(windows().all.some((w) => route(w) === "/projection/file" && w !== proj)).toBe(false);
      await closeMedia();

      // Da próxima vez o arquivo já está lá: toca dele, sem player do YouTube.
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
      expect(local.projection.frames).toEqual([]);
    } finally {
      await closeMedia();
      await setPref("options.online_video_projection.play_while_downloading", false);
      await main.evaluate((id) => window.louvorjaApi.onlineVideo.remove(id), LONG);
    }
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
});
