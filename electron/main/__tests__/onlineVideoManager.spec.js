// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import os from "os";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const { createManager, MIN_FREE_BYTES, SESSION_IDLE_MS } = require("../onlineVideo/manager.js");
const { OnlineVideoError } = require("../onlineVideo/runner.js");

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";

let dir;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeTools(overrides = {}) {
  const paths = { ytdlp: "/fake/yt-dlp", ffmpeg: "/fake/ffmpeg" };
  return {
    supported: true,
    ready: vi.fn(() => true),
    paths: vi.fn(() => paths),
    ensure: vi.fn(async () => paths),
    refreshYtdlp: vi.fn(async () => "2099.01.01"),
    works: vi.fn(async () => true),
    ffmpegWorks: vi.fn(async () => true),
    reset: vi.fn(async () => {}),
    info: vi.fn(async () => ({ supported: true, ready: true, ytdlpVersion: "2026.01.02" })),
    ...overrides,
  };
}

/** run falso: grava o MP4 no outDir, como o runner de verdade. */
function okRun(size = 10) {
  return vi.fn(async ({ outDir, id, onProgress }) => {
    onProgress?.({ percent: 50, downloaded: 5, total: 10, speed: 1, eta: 1 });
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${id}.mp4`);
    fs.writeFileSync(file, Buffer.alloc(size, 1));
    return { file, size, meta: { height: 1080 } };
  });
}

/** Sem trilhas servidas direto (só formatos em fragmentos): o download cai no yt-dlp. */
const noDirectLinks = async () => {
  throw new OnlineVideoError("format", "Nenhum vídeo servido direto");
};

function make(overrides = {}) {
  const tools = overrides.tools ?? fakeTools();
  const run = overrides.run ?? okRun();
  const manager = createManager({
    dir,
    tools,
    run,
    resolve: noDirectLinks,
    freeBytes: async () => MIN_FREE_BYTES * 10,
    ...overrides,
  });
  return { manager, tools, run };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-mgr-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("ensure — caminho feliz", () => {
  it("baixa, move para o cache e devolve a URL louvorja://", async () => {
    const { manager, run } = make();
    const res = await manager.ensure(A);
    expect(res).toMatchObject({
      ok: true,
      id: A,
      url: `louvorja://onlinevideo/${A}.mp4`,
      size: 10,
      cached: false,
      meta: { height: 1080 },
    });
    expect(fs.existsSync(path.join(dir, `${A}.mp4`))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".partial", A))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].id).toBe(A);
  });

  it("na segunda vez vem do cache, sem baixar", async () => {
    const { manager, run } = make();
    await manager.ensure(A);
    const again = await manager.ensure(A);
    expect(again).toMatchObject({ ok: true, cached: true, url: `louvorja://onlinevideo/${A}.mp4` });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("acerta o vídeo do cache como usado agora", async () => {
    const { manager } = make();
    await manager.ensure(A);
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(path.join(dir, `${A}.mp4`), old, old);
    await manager.ensure(A);
    const st = fs.statSync(path.join(dir, `${A}.mp4`));
    expect(Date.now() - st.mtimeMs).toBeLessThan(5000);
  });

  it("passa a altura máxima ao runner, limitada aos valores permitidos", async () => {
    const { manager, run } = make();
    await manager.ensure(A, { maxHeight: 720 });
    expect(run.mock.calls[0][0].maxHeight).toBe(720);
    await manager.ensure(B, { maxHeight: 99999 });
    expect(run.mock.calls[1][0].maxHeight).toBe(1080);
  });

  it("reporta as fases na ordem: fila → download → finalização → pronto", async () => {
    const { manager } = make();
    const phases = [];
    await manager.ensure(A, {}, (e) => phases.push(e.phase));
    expect(phases[0]).toBe("queued");
    expect(phases).toContain("downloading");
    expect(phases.indexOf("finalizing")).toBeGreaterThan(phases.indexOf("downloading"));
    expect(phases.at(-1)).toBe("done");
  });

  it("todo evento leva o id do vídeo", async () => {
    const { manager } = make();
    const events = [];
    await manager.ensure(A, {}, (e) => events.push(e));
    expect(events.length).toBeGreaterThan(2);
    expect(events.every((e) => e.id === A)).toBe(true);
  });
});

describe("ensure — validação e limites", () => {
  it("recusa ID inválido sem tocar em nada", async () => {
    const { manager, run, tools } = make();
    for (const bad of ["../../x", "", null, undefined, 42, "--exec=calc"]) {
      expect(await manager.ensure(bad)).toMatchObject({ ok: false, error: { kind: "invalid" } });
    }
    expect(run).not.toHaveBeenCalled();
    expect(tools.ensure).not.toHaveBeenCalled();
  });

  it("recusa plataforma sem suporte", async () => {
    const { manager, run } = make({ tools: fakeTools({ supported: false }) });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "unsupported" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("recusa baixar com pouco espaço em disco", async () => {
    const { manager, run } = make({ freeBytes: async () => MIN_FREE_BYTES - 1 });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "disk" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("segue em frente quando não consegue medir o disco", async () => {
    const { manager } = make({ freeBytes: async () => null });
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
  });
});

describe("ensure — ferramentas", () => {
  it("instala as ferramentas na primeira vez e diz isso no resultado", async () => {
    const tools = fakeTools({ ready: vi.fn(() => false) });
    const { manager } = make({ tools });
    const phases = [];
    const res = await manager.ensure(A, {}, (e) => phases.push(e.phase));
    expect(tools.ensure).toHaveBeenCalledTimes(1);
    expect(res.installedTools).toBe(true);
    expect(phases).toContain("tools");
    expect(phases.indexOf("tools")).toBeLessThan(phases.indexOf("downloading"));
  });

  it("com as ferramentas já instaladas não passa pela instalação", async () => {
    const { manager, tools } = make();
    const res = await manager.ensure(A);
    expect(tools.ensure).not.toHaveBeenCalled();
    expect(res.installedTools).toBe(false);
  });

  it("falha ao instalar as ferramentas vira erro tratável, não exceção", async () => {
    const tools = fakeTools({
      ready: vi.fn(() => false),
      ensure: vi.fn(async () => {
        throw new OnlineVideoError("network", "sem GitHub");
      }),
    });
    const { manager, run } = make({ tools });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("binário corrompido: reinstala e tenta de novo uma vez", async () => {
    const good = okRun();
    let n = 0;
    const run = vi.fn((opts) => {
      if (n++ === 0) return Promise.reject(new OnlineVideoError("tool", "EACCES"));
      return good(opts);
    });
    const { manager, tools } = make({ run });
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
    expect(tools.reset).toHaveBeenCalledTimes(1);
    expect(tools.ensure).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("binário que continua quebrado não entra em laço", async () => {
    const run = vi.fn(async () => {
      throw new OnlineVideoError("tool", "EACCES");
    });
    const { manager, tools } = make({ run });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "tool" } });
    expect(tools.reset).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("ensure — ffmpeg conferido antes de baixar", () => {
  it("ffmpeg instalado mas quebrado: reinstala ANTES do download (senão o yt-dlp cai em 360p sem avisar)", async () => {
    const tools = fakeTools({ ffmpegWorks: vi.fn(async () => false) });
    const { manager, run } = make({ tools });
    const res = await manager.ensure(A);
    expect(res).toMatchObject({ ok: true, installedTools: true });
    expect(tools.reset).toHaveBeenCalledTimes(1);
    expect(tools.ensure).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(tools.reset.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
    expect(tools.ensure.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
  });

  it("ffmpeg saudável: só a verificação, sem reinstalar nada", async () => {
    const { manager, tools } = make();
    const res = await manager.ensure(A);
    expect(tools.ffmpegWorks).toHaveBeenCalledTimes(1);
    expect(tools.reset).not.toHaveBeenCalled();
    expect(tools.ensure).not.toHaveBeenCalled();
    expect(res.installedTools).toBe(false);
  });

  it("vídeo já em cache não gasta nem a verificação", async () => {
    const { manager, tools } = make();
    await manager.ensure(A);
    tools.ffmpegWorks.mockClear();
    await manager.ensure(A);
    expect(tools.ffmpegWorks).not.toHaveBeenCalled();
  });

  it("na primeira instalação não confere de novo: o instalador já testou o binário", async () => {
    const tools = fakeTools({ ready: vi.fn(() => false) });
    const { manager } = make({ tools });
    await manager.ensure(A);
    expect(tools.ffmpegWorks).not.toHaveBeenCalled();
    expect(tools.reset).not.toHaveBeenCalled();
  });

  it("a reinstalação que falha por rede vira erro tratável e nada é baixado", async () => {
    const tools = fakeTools({
      ffmpegWorks: vi.fn(async () => false),
      ensure: vi.fn(async () => {
        throw new OnlineVideoError("network", "sem GitHub");
      }),
    });
    const { manager, run } = make({ tools });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("depois do reparo prévio, uma falha 'tool' não reinstala outra vez", async () => {
    const run = vi.fn(async () => {
      throw new OnlineVideoError("tool", "EACCES");
    });
    const tools = fakeTools({ ffmpegWorks: vi.fn(async () => false) });
    const { manager } = make({ run, tools });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "tool" } });
    expect(tools.reset).toHaveBeenCalledTimes(1); // só o reparo prévio
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a barra reserva o começo para as ferramentas também no reparo prévio", async () => {
    const tools = fakeTools({ ffmpegWorks: vi.fn(async () => false) });
    const run = vi.fn(async (opts) => {
      opts.onProgress({ percent: 0 });
      return okRun()(opts);
    });
    const { manager } = make({ tools, run });
    const events = [];
    await manager.ensure(A, {}, (e) => events.push(e));
    const firstDownload = events.find((e) => e.phase === "downloading");
    expect(firstDownload.percent).toBeGreaterThanOrEqual(25);
  });
});

describe("ensure — ffmpeg quebrado chega como erro genérico", () => {
  it("erro genérico com binário que não executa: reinstala em vez de renovar o yt-dlp", async () => {
    const good = okRun();
    let n = 0;
    const run = vi.fn((opts) => {
      if (n++ === 0) return Promise.reject(new OnlineVideoError("unknown", "Postprocessing: ffmpeg"));
      return good(opts);
    });
    const tools = fakeTools({ works: vi.fn(async () => false) });
    const { manager } = make({ run, tools });
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
    expect(tools.works).toHaveBeenCalledTimes(1);
    expect(tools.reset).toHaveBeenCalledTimes(1);
    expect(tools.ensure).toHaveBeenCalledTimes(1);
    expect(tools.refreshYtdlp).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("erro genérico com os binários saudáveis: segue para a renovação do yt-dlp", async () => {
    const good = okRun();
    let n = 0;
    const run = vi.fn((opts) => {
      if (n++ === 0) return Promise.reject(new OnlineVideoError("unknown", "algo novo"));
      return good(opts);
    });
    const tools = fakeTools({ works: vi.fn(async () => true) });
    const { manager } = make({ run, tools });
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
    expect(tools.reset).not.toHaveBeenCalled();
    expect(tools.refreshYtdlp).toHaveBeenCalledTimes(1);
  });

  it("binário que continua quebrado depois do reparo não entra em laço", async () => {
    const run = vi.fn(async () => {
      throw new OnlineVideoError("unknown", "Postprocessing: ffmpeg");
    });
    const tools = fakeTools({ works: vi.fn(async () => false) });
    const { manager } = make({ run, tools });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "unknown" } });
    expect(tools.reset).toHaveBeenCalledTimes(1);
    expect(run.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it.each(["private", "age", "geo", "unavailable", "network", "disk"])(
    "erro '%s' não gasta nem a verificação dos binários",
    async (kind) => {
      const run = vi.fn(async () => {
        throw new OnlineVideoError(kind, "x");
      });
      const tools = fakeTools();
      const { manager } = make({ run, tools });
      await manager.ensure(A);
      expect(tools.works).not.toHaveBeenCalled();
    }
  );
});

describe("ensure — yt-dlp desatualizado", () => {
  it("falha que uma versão nova resolve: renova o yt-dlp e repete uma vez", async () => {
    const good = okRun();
    let n = 0;
    const run = vi.fn((opts) => {
      if (n++ === 0) return Promise.reject(new OnlineVideoError("forbidden", "HTTP Error 403"));
      return good(opts);
    });
    const { manager, tools } = make({ run });
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
    expect(tools.refreshYtdlp).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("se a renovação não adianta, devolve o erro (uma renovação só)", async () => {
    const run = vi.fn(async () => {
      throw new OnlineVideoError("forbidden", "HTTP Error 403");
    });
    const { manager, tools } = make({ run });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    expect(tools.refreshYtdlp).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("não baixa 37 MB de novo a cada clique: há um intervalo mínimo entre renovações", async () => {
    let t = 1_000_000;
    const run = vi.fn(async () => {
      throw new OnlineVideoError("unknown", "algo");
    });
    const { manager, tools } = make({ run, now: () => t });
    await manager.ensure(A);
    t += 60_000; // um minuto depois
    await manager.ensure(B);
    expect(tools.refreshYtdlp).toHaveBeenCalledTimes(1);
    t += 2 * 3600_000; // duas horas depois
    await manager.ensure(C);
    expect(tools.refreshYtdlp).toHaveBeenCalledTimes(2);
  });

  it("o intervalo entre renovações é configurável: com 0, uma renovação recente não bloqueia a seguinte", async () => {
    let t = 1_000_000;
    const run = vi.fn(async () => {
      throw new OnlineVideoError("unknown", "algo");
    });
    const { manager, tools } = make({ run, now: () => t, refreshCooldownMs: 0 });
    await manager.ensure(A);
    t += 1; // um instante depois
    await manager.ensure(B);
    expect(tools.refreshYtdlp).toHaveBeenCalledTimes(2);
  });

  it.each(["private", "age", "geo", "live", "unavailable", "network", "disk"])(
    "erro '%s' é do vídeo ou da rede: não renova o yt-dlp",
    async (kind) => {
      const run = vi.fn(async () => {
        throw new OnlineVideoError(kind, "x");
      });
      const { manager, tools } = make({ run });
      expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind } });
      expect(tools.refreshYtdlp).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledTimes(1);
    }
  );

  it("exceção que não é OnlineVideoError vira 'unknown'", async () => {
    const run = vi.fn(async () => {
      throw new TypeError("bug");
    });
    const { manager } = make({ run });
    expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "unknown", message: "bug" } });
  });

  it("depois de falhar, o vídeo não fica marcado como em cache", async () => {
    const run = vi.fn(async () => {
      throw new OnlineVideoError("private", "x");
    });
    const { manager } = make({ run });
    await manager.ensure(A);
    expect(fs.existsSync(path.join(dir, `${A}.mp4`))).toBe(false);
    expect((await manager.status()).count).toBe(0);
  });
});

describe("concorrência", () => {
  it("dois pedidos do mesmo vídeo viram um download, e os dois recebem o progresso", async () => {
    const gate = deferred();
    const run = vi.fn(async (opts) => {
      await gate.promise;
      return okRun()(opts);
    });
    const { manager } = make({ run });
    const e1 = [];
    const e2 = [];
    const p1 = manager.ensure(A, {}, (e) => e1.push(e.phase));
    const p2 = manager.ensure(A, {}, (e) => e2.push(e.phase));
    gate.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
    expect(e2).toContain("done");
    expect(e1).toContain("done");
  });

  it("um download por vez: o segundo espera o primeiro terminar", async () => {
    const gate = deferred();
    const order = [];
    const run = vi.fn(async (opts) => {
      order.push(`start ${opts.id}`);
      if (opts.id === A) await gate.promise;
      const r = await okRun()(opts);
      order.push(`end ${opts.id}`);
      return r;
    });
    const { manager } = make({ run });
    const pA = manager.ensure(A);
    const pB = manager.ensure(B);
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual([`start ${A}`]);
    gate.resolve();
    await Promise.all([pA, pB]);
    expect(order).toEqual([`start ${A}`, `end ${A}`, `start ${B}`, `end ${B}`]);
  });

  it("uma falha não trava a fila: o próximo vídeo baixa normalmente", async () => {
    const good = okRun();
    const run = vi.fn(async (opts) => {
      if (opts.id === A) throw new OnlineVideoError("private", "x");
      return good(opts);
    });
    const { manager } = make({ run });
    const [rA, rB] = await Promise.all([manager.ensure(A), manager.ensure(B)]);
    expect(rA.ok).toBe(false);
    expect(rB.ok).toBe(true);
  });

  it("pedir de novo depois de terminar refaz o job (não fica preso no antigo)", async () => {
    const run = vi.fn(async () => {
      throw new OnlineVideoError("network", "x");
    });
    const { manager } = make({ run });
    await manager.ensure(A);
    await manager.ensure(A);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("raias: o que é urgente não espera pré-download", () => {
  /** run que só termina quando o teste manda, por vídeo. */
  function gated() {
    const gates = { [A]: deferred(), [B]: deferred(), [C]: deferred() };
    const order = [];
    const good = okRun();
    const run = vi.fn(async (opts) => {
      order.push(`start ${opts.id}`);
      await gates[opts.id].promise;
      const r = await good(opts);
      order.push(`end ${opts.id}`);
      return r;
    });
    return { gates, order, run };
  }
  const tick = () => new Promise((r) => setTimeout(r, 30));

  it("projetar agora começa na hora, mesmo com um pré-download em andamento", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    const bg = manager.ensure(A, { priority: "background" });
    await tick();
    const fg = manager.ensure(B);
    await tick();
    expect(order).toEqual([`start ${A}`, `start ${B}`]);
    gates[B].resolve();
    expect(await fg).toMatchObject({ ok: true, id: B });
    gates[A].resolve();
    expect(await bg).toMatchObject({ ok: true, id: A });
  });

  it("segura novos pré-downloads durante a apresentação, mas foreground continua livre", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    manager.setBackgroundAdmissionBlocked(true);
    const bg = manager.ensure(A, { priority: "background" });
    await tick();
    expect(order).toEqual([]);
    expect(manager.diagnosticSnapshot()).toMatchObject({
      online_video_background_admission_blocked: true,
      online_video_background_running: 0,
      online_video_background_queued: 1,
    });

    const fg = manager.ensure(B);
    await tick();
    expect(order).toEqual([`start ${B}`]);
    gates[B].resolve();
    await fg;

    manager.setBackgroundAdmissionBlocked(false);
    await tick();
    expect(order).toContain(`start ${A}`);
    gates[A].resolve();
    await bg;
  });

  it("não interrompe pré-download em voo e não concede o próximo até desbloquear", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    const first = manager.ensure(A, { priority: "background" });
    await tick();
    manager.setBackgroundAdmissionBlocked(true);
    const queued = manager.ensure(B, { priority: "background" });

    gates[A].resolve();
    await first;
    await tick();
    expect(order).toEqual([`start ${A}`, `end ${A}`]);

    manager.setBackgroundAdmissionBlocked(false);
    await tick();
    expect(order).toContain(`start ${B}`);
    gates[B].resolve();
    await queued;
  });

  it("cancelar enquanto bloqueado remove o pedido sem travar o próximo", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    manager.setBackgroundAdmissionBlocked(true);
    const cancelled = manager.ensure(A, { priority: "background" });
    const next = manager.ensure(B, { priority: "background" });
    manager.cancel(A);

    expect(await cancelled).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    expect(order).toEqual([]);
    manager.setBackgroundAdmissionBlocked(false);
    await tick();
    expect(order).toEqual([`start ${B}`]);
    gates[B].resolve();
    await next;
  });

  it("tocar um pré-download bloqueado o promove e começa sem esperar", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    manager.setBackgroundAdmissionBlocked(true);
    const background = manager.ensure(A, { priority: "background" });
    await tick();
    const urgent = manager.ensure(A);
    await tick();

    expect(urgent).toBe(background);
    expect(order).toEqual([`start ${A}`]);
    gates[A].resolve();
    await urgent;
  });

  it("stream também libera um pré-download bloqueado sem esperar o admission gate", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    manager.setBackgroundAdmissionBlocked(true);
    const background = manager.ensure(A, { priority: "background" });
    await tick();

    expect(await manager.stream(A)).toMatchObject({ ok: false, error: { kind: "busy" } });
    await tick();
    expect(order).toEqual([`start ${A}`]);
    gates[A].resolve();
    await background;
  });

  it("expõe somente o retrato agregado das raias para um incidente", async () => {
    const { gates, run } = gated();
    let clock = 10_000;
    const { manager, tools } = make({ run, now: () => clock });
    const bg = manager.ensure(A, { priority: "background" });
    const fg = manager.ensure(B);
    const queued = manager.ensure(C, { priority: "background" });
    await tick();

    clock += 2_500;
    const snapshot = manager.diagnosticSnapshot();
    expect(snapshot).toMatchObject({
      online_video_manager_initialized: true,
      online_video_active_count: 3,
      online_video_foreground_running: 1,
      online_video_background_running: 1,
      online_video_foreground_queued: 0,
      online_video_background_queued: 1,
    });
    expect(snapshot.online_video_jobs).toHaveLength(3);
    expect(snapshot.online_video_jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priority: "foreground", lane: "foreground", phase: "downloading", age_bucket: "lt_10s" }),
        expect.objectContaining({ priority: "background", lane: "background", phase: "downloading", age_bucket: "lt_10s" }),
        expect.objectContaining({ priority: "background", lane: "queued", phase: "queued", age_bucket: "lt_10s" }),
      ])
    );
    expect(tools.info).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain(A);
    expect(JSON.stringify(snapshot)).not.toContain(B);
    expect(JSON.stringify(snapshot)).not.toContain(C);

    gates[A].resolve();
    gates[B].resolve();
    gates[C].resolve();
    await Promise.all([bg, fg, queued]);
  });

  it("pré-downloads entre si seguem em fila: um por vez", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    const p1 = manager.ensure(A, { priority: "background" });
    const p2 = manager.ensure(B, { priority: "background" });
    await tick();
    expect(order).toEqual([`start ${A}`]);
    gates[A].resolve();
    await p1;
    await tick();
    expect(order).toContain(`start ${B}`);
    gates[B].resolve();
    await p2;
  });

  it("dois pedidos urgentes seguem em fila entre si", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    const p1 = manager.ensure(A);
    const p2 = manager.ensure(B);
    await tick();
    expect(order).toEqual([`start ${A}`]);
    gates[A].resolve();
    await p1;
    await tick();
    gates[B].resolve();
    await p2;
    expect(order).toEqual([`start ${A}`, `end ${A}`, `start ${B}`, `end ${B}`]);
  });

  it("projetar um vídeo que esperava na fila de pré-download o passa para a frente", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    const first = manager.ensure(A, { priority: "background" });
    const queued = manager.ensure(B, { priority: "background" });
    await tick();
    expect(order).toEqual([`start ${A}`]); // B espera atrás de A
    const urgent = manager.ensure(B); // o operador clicou em projetar B
    await tick();
    expect(order).toEqual([`start ${A}`, `start ${B}`]);
    expect(urgent).toBe(queued); // é o mesmo trabalho, só que agora com pressa
    gates[B].resolve();
    expect(await urgent).toMatchObject({ ok: true, id: B });
    gates[A].resolve();
    await first;
  });

  it("promover um pré-download que já baixa não o reinicia nem ocupa a raia urgente", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    const bg = manager.ensure(A, { priority: "background" });
    await tick();
    const same = manager.ensure(A); // projetar o vídeo que já está baixando
    expect(same).toBe(bg);
    const other = manager.ensure(B); // e outro pedido urgente ainda começa na hora
    await tick();
    expect(order).toEqual([`start ${A}`, `start ${B}`]);
    expect(run).toHaveBeenCalledTimes(2);
    gates[A].resolve();
    gates[B].resolve();
    await Promise.all([bg, other]);
  });

  it("cancelar um pré-download na fila não trava a raia: o próximo baixa", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    const p1 = manager.ensure(A, { priority: "background" });
    const p2 = manager.ensure(B, { priority: "background" });
    const p3 = manager.ensure(C, { priority: "background" });
    await tick();
    manager.cancel(B);
    expect(await p2).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    gates[A].resolve();
    await p1;
    await tick();
    expect(order).toContain(`start ${C}`);
    expect(order).not.toContain(`start ${B}`);
    gates[C].resolve();
    await p3;
  });

  it("cancelar um pedido promovido, ainda na fila, também o tira dela", async () => {
    const { gates, order, run } = gated();
    const { manager } = make({ run });
    const urgent = manager.ensure(C); // raia urgente ocupada
    const bg = manager.ensure(A, { priority: "background" }); // raia de pré-download ocupada
    const queued = manager.ensure(B, { priority: "background" }); // espera atrás de A
    await tick();
    manager.ensure(B); // promovido: passa a esperar atrás de C, na raia urgente
    manager.cancel(B);
    expect(await queued).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    gates[C].resolve();
    await urgent;
    await tick();
    expect(order).not.toContain(`start ${B}`); // a vaga de C não foi para um pedido cancelado
    gates[A].resolve();
    await bg;
  });

  it("não troca as ferramentas com outro download usando-as: falha normal, sem renovar o yt-dlp", async () => {
    const gate = deferred();
    const good = okRun();
    const run = vi.fn(async (opts) => {
      if (opts.id === A) {
        await gate.promise;
        return good(opts);
      }
      throw new OnlineVideoError("format", "extrator desatualizado");
    });
    const { manager, tools } = make({ run });
    const bg = manager.ensure(A, { priority: "background" });
    await new Promise((r) => setTimeout(r, 30));
    const res = await manager.ensure(B);
    expect(res).toMatchObject({ ok: false, error: { kind: "format" } });
    expect(tools.refreshYtdlp).not.toHaveBeenCalled();
    expect(tools.reset).not.toHaveBeenCalled();
    gate.resolve();
    await bg;
  });

  it("sozinho, o mesmo erro ainda renova o yt-dlp e tenta de novo", async () => {
    const good = okRun();
    let calls = 0;
    const run = vi.fn(async (opts) => {
      if (++calls === 1) throw new OnlineVideoError("format", "extrator desatualizado");
      return good(opts);
    });
    const { manager, tools } = make({ run });
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
    expect(tools.refreshYtdlp).toHaveBeenCalledTimes(1);
  });
});

describe("prepare (ferramentas de antemão)", () => {
  it("instala as ferramentas em silêncio quando faltam", async () => {
    const tools = fakeTools({ ready: vi.fn(() => false) });
    const { manager } = make({ tools });
    expect(await manager.prepare()).toEqual({ ok: true, ready: true });
    expect(tools.ensure).toHaveBeenCalledTimes(1);
  });

  it("já instaladas: não faz nada", async () => {
    const tools = fakeTools();
    const { manager } = make({ tools });
    expect(await manager.prepare()).toEqual({ ok: true, ready: true });
    expect(tools.ensure).not.toHaveBeenCalled();
  });

  it("falha vira resultado tratável, nunca exceção", async () => {
    const tools = fakeTools({
      ready: vi.fn(() => false),
      ensure: vi.fn(async () => {
        throw new OnlineVideoError("network", "sem rede");
      }),
    });
    const { manager } = make({ tools });
    expect(await manager.prepare()).toMatchObject({ ok: false, error: { kind: "network" } });
  });

  it("plataforma sem suporte: recusa sem tentar", async () => {
    const tools = fakeTools({ supported: false });
    const { manager } = make({ tools });
    expect(await manager.prepare()).toMatchObject({ ok: false, error: { kind: "unsupported" } });
    expect(tools.ensure).not.toHaveBeenCalled();
  });

  it("um vídeo pedido durante o preparo usa a mesma instalação (as ferramentas não são instaladas duas vezes)", async () => {
    let installed = false;
    const gate = deferred();
    const tools = fakeTools({
      ready: vi.fn(() => installed),
      ensure: vi.fn(async () => {
        await gate.promise;
        installed = true;
        return { ytdlp: "/fake/yt-dlp", ffmpeg: "/fake/ffmpeg" };
      }),
    });
    const { manager } = make({ tools });
    const preparing = manager.prepare();
    const playing = manager.ensure(A);
    gate.resolve();
    await preparing;
    expect(await playing).toMatchObject({ ok: true, installedTools: true });
    expect(tools.ensure).toHaveBeenCalledTimes(2); // dois pedidos, e é o tools que os une numa instalação só
  });
});

describe("manter o vídeo baixado", () => {
  it("baixar com keep marca o vídeo como mantido", async () => {
    const { manager } = make();
    await manager.ensure(A, { keep: true });
    expect(manager.store.isKept(A)).toBe(true);
    expect((await manager.list()).find((v) => v.id === A)).toMatchObject({ kept: true });
  });

  it("sem keep, o vídeo é só cache", async () => {
    const { manager } = make();
    await manager.ensure(A);
    expect(manager.store.isKept(A)).toBe(false);
  });

  it("pedir keep de um vídeo já em cache o marca sem baixar de novo", async () => {
    const { manager, run } = make();
    await manager.ensure(A);
    expect(manager.store.isKept(A)).toBe(false);
    const res = await manager.ensure(A, { keep: true });
    expect(res).toMatchObject({ ok: true, cached: true });
    expect(manager.store.isKept(A)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keep pedido no meio de um download em curso vale ao terminar", async () => {
    const gate = deferred();
    const good = okRun();
    const run = vi.fn(async (opts) => {
      await gate.promise;
      return good(opts);
    });
    const { manager } = make({ run });
    const first = manager.ensure(A); // projeção, sem keep
    manager.ensure(A, { keep: true }); // o operador também mandou baixar e manter
    gate.resolve();
    await first;
    expect(manager.store.isKept(A)).toBe(true);
  });

  it("manter sobrevive ao despejo por cota, que leva só o automático", async () => {
    const t0 = Date.now() - 100_000;
    for (const [id, offset] of [[A, 0], [B, 1000]]) {
      fs.writeFileSync(path.join(dir, `${id}.mp4`), Buffer.alloc(100, 1));
      const t = new Date(t0 + offset);
      fs.utimesSync(path.join(dir, `${id}.mp4`), t, t);
    }
    const { manager } = make({ run: okRun(100), maxBytes: 150 });
    expect(manager.keep(A)).toBe(true); // o mais antigo, mas o operador o quer
    await manager.ensure(C);
    expect(fs.existsSync(path.join(dir, `${A}.mp4`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${B}.mp4`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${C}.mp4`))).toBe(true);
  });

  it("keep recusa ID inválido e vídeo que não está no disco", () => {
    const { manager } = make();
    expect(manager.keep("../x")).toBe(false);
    expect(manager.keep(A)).toBe(false);
  });

  it("remove tira também a marca", async () => {
    const { manager } = make();
    await manager.ensure(A, { keep: true });
    await manager.remove(A);
    expect(manager.store.isKept(A)).toBe(false);
    expect(await manager.list()).toEqual([]);
  });
});

describe("cancelamento", () => {
  it("cancela o download em andamento e o runner recebe o sinal", async () => {
    let signal;
    const run = vi.fn(
      (opts) =>
        new Promise((_res, rej) => {
          signal = opts.signal;
          opts.signal.addEventListener("abort", () => rej(new OnlineVideoError("cancelled", "c")));
        })
    );
    const { manager } = make({ run });
    const p = manager.ensure(A);
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.cancel(A)).toBe(true);
    expect(await p).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    expect(signal.aborted).toBe(true);
  });

  it("cancelar um vídeo que estava na fila o tira dela sem nunca baixá-lo", async () => {
    const gate = deferred();
    const run = vi.fn(async (opts) => {
      if (opts.id === A) await gate.promise;
      return okRun()(opts);
    });
    const { manager } = make({ run });
    const pA = manager.ensure(A);
    const pB = manager.ensure(B);
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.cancel(B)).toBe(true);
    expect(await pB).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    gate.resolve();
    expect(await pA).toMatchObject({ ok: true });
    expect(run.mock.calls.map((c) => c[0].id)).toEqual([A]);
  });

  it("cancelar e pedir o mesmo vídeo na hora baixa de verdade, sem pegar carona no job que ainda está morrendo", async () => {
    const good = okRun();
    const events = [];
    let calls = 0;
    const run = vi.fn(async (opts) => {
      const n = ++calls;
      events.push(`start ${n}`);
      if (n === 1) {
        // O yt-dlp leva um instante para sair depois do sinal.
        return new Promise((_, reject) =>
          opts.signal.addEventListener("abort", () =>
            setTimeout(() => {
              events.push("end 1 (cancelado)");
              reject(new OnlineVideoError("cancelled", "Download cancelado"));
            }, 40)
          )
        );
      }
      const r = await good(opts);
      events.push(`end ${n}`);
      return r;
    });
    const { manager } = make({ run });

    const first = manager.ensure(A);
    await new Promise((r) => setTimeout(r, 20));
    manager.cancel(A);
    const second = manager.ensure(A); // o operador clicou de novo, com o job antigo ainda saindo

    expect(await first).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    expect(await second).toMatchObject({ ok: true, id: A, cached: false });
    expect(run).toHaveBeenCalledTimes(2);
    // Um de cada vez na mesma pasta de parciais: o novo só começa depois que o antigo saiu.
    expect(events).toEqual(["start 1", "end 1 (cancelado)", "start 2", "end 2"]);
  });

  it("pedir de novo um vídeo cancelado que já saiu também baixa normalmente", async () => {
    const { manager, run } = make();
    const first = manager.ensure(A);
    manager.cancel(A);
    await first;
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancelar o que não está em andamento devolve false", () => {
    const { manager } = make();
    expect(manager.cancel(A)).toBe(false);
    expect(manager.cancel("../x")).toBe(false);
  });

  it("cancelAll derruba o que roda e o que espera", async () => {
    const run = vi.fn(
      (opts) =>
        new Promise((_res, rej) => {
          opts.signal.addEventListener("abort", () => rej(new OnlineVideoError("cancelled", "c")));
        })
    );
    const { manager } = make({ run });
    const ps = [manager.ensure(A), manager.ensure(B), manager.ensure(C)];
    await new Promise((r) => setTimeout(r, 20));
    manager.cancelAll();
    const results = await Promise.all(ps);
    expect(results.every((r) => r.ok === false && r.error.kind === "cancelled")).toBe(true);
    expect((await manager.status()).active).toEqual([]);
  });

  it("depois de cancelar, dá para baixar o mesmo vídeo de novo", async () => {
    let first = true;
    const good = okRun();
    const run = vi.fn((opts) => {
      if (first) {
        first = false;
        return new Promise((_res, rej) => {
          opts.signal.addEventListener("abort", () => rej(new OnlineVideoError("cancelled", "c")));
        });
      }
      return good(opts);
    });
    const { manager } = make({ run });
    const p = manager.ensure(A);
    await new Promise((r) => setTimeout(r, 20));
    manager.cancel(A);
    await p;
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
  });
});

describe("cache", () => {
  it("despeja os menos usados quando passa da cota, poupando o recém-baixado", async () => {
    const t0 = Date.now() - 100_000;
    for (const [id, offset] of [[A, 0], [B, 1000]]) {
      fs.writeFileSync(path.join(dir, `${id}.mp4`), Buffer.alloc(100, 1));
      const t = new Date(t0 + offset);
      fs.utimesSync(path.join(dir, `${id}.mp4`), t, t);
    }
    const { manager } = make({ run: okRun(100), maxBytes: 250 });
    await manager.ensure(C);
    expect(fs.existsSync(path.join(dir, `${A}.mp4`))).toBe(false); // o mais antigo saiu
    expect(fs.existsSync(path.join(dir, `${B}.mp4`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${C}.mp4`))).toBe(true);
  });

  it("cota menor que o próprio vídeo não apaga o vídeo que acabou de baixar", async () => {
    const { manager } = make({ run: okRun(500), maxBytes: 10 });
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(dir, `${A}.mp4`))).toBe(true);
  });

  it("falha ao despejar nunca invalida o download que deu certo", async () => {
    const { manager } = make({ maxBytes: 5 });
    manager.store.evict = async () => {
      throw new Error("EBUSY");
    };
    expect(await manager.ensure(A)).toMatchObject({ ok: true });
  });

  it("status conta vídeos e bytes, e lista o que está baixando", async () => {
    const gate = deferred();
    const run = vi.fn(async (opts) => {
      if (opts.id === B) await gate.promise;
      return okRun(40)(opts);
    });
    const { manager } = make({ run });
    await manager.ensure(A);
    const pB = manager.ensure(B);
    await new Promise((r) => setTimeout(r, 20));
    const during = await manager.status();
    expect(during).toMatchObject({ supported: true, count: 1, size: 40, active: [B], cacheDir: dir });
    gate.resolve();
    await pB;
    expect(await manager.status()).toMatchObject({ count: 2, size: 80, active: [] });
  });

  it("remove apaga o vídeo e cancela o download dele", async () => {
    const { manager } = make();
    await manager.ensure(A);
    expect(await manager.remove(A)).toBe(true);
    expect(manager.store.has(A)).toBe(false);
    expect(await manager.remove("../x")).toBe(false);
  });

  it("clear esvazia o cache e devolve quantos eram", async () => {
    const { manager } = make();
    await manager.ensure(A);
    await manager.ensure(B);
    expect(await manager.clear()).toBe(2);
    expect(await manager.list()).toEqual([]);
  });

  it("init varre parciais velhos", async () => {
    const { manager } = make();
    const velho = manager.store.partialDirFor(A);
    fs.mkdirSync(velho, { recursive: true });
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    fs.utimesSync(velho, old, old);
    expect(await manager.init()).toBe(1);
  });
});

describe("barra de progresso única", () => {
  const collect = (events) => events.map((e) => e.percent);
  const nonDecreasing = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

  it("na primeira vez: ferramentas ocupam o começo, o vídeo o resto, e a barra só sobe", async () => {
    const tools = fakeTools({
      ready: vi.fn(() => false),
      ensure: vi.fn(async ({ onProgress }) => {
        for (const p of [0, 50, 100]) onProgress({ tool: "yt-dlp", received: p, total: 100 });
        for (const p of [0, 50, 100]) onProgress({ tool: "ffmpeg", received: p, total: 100 });
        return { ytdlp: "/y", ffmpeg: "/f" };
      }),
    });
    const run = vi.fn(async (opts) => {
      for (const p of [0, 40, 80, 99]) opts.onProgress({ percent: p, downloaded: p, total: 99 });
      return okRun()(opts);
    });
    const { manager } = make({ tools, run, now: (() => { let t = 0; return () => (t += 1000); })() });
    const events = [];
    await manager.ensure(A, {}, (e) => events.push(e));

    const percents = collect(events);
    expect(nonDecreasing(percents)).toBe(true);
    const toolsPhase = events.filter((e) => e.phase === "tools").map((e) => e.percent);
    const downloading = events.filter((e) => e.phase === "downloading");
    expect(Math.max(...toolsPhase)).toBeLessThanOrEqual(25);
    expect(Math.min(...downloading.map((e) => e.percent))).toBeGreaterThanOrEqual(25);
    expect(Math.max(...downloading.map((e) => e.percent))).toBeLessThanOrEqual(99);
    expect(events.at(-1)).toMatchObject({ phase: "done", percent: 100 });
    // o texto "Baixando N%" deve falar do vídeo, não da barra geral
    expect(downloading.map((e) => e.phasePercent)).toEqual(expect.arrayContaining([0, 40, 80, 99]));
  });

  it("com as ferramentas prontas o vídeo usa a barra inteira, de 0 a 99", async () => {
    const run = vi.fn(async (opts) => {
      for (const p of [0, 50, 99]) opts.onProgress({ percent: p });
      return okRun()(opts);
    });
    const { manager } = make({ run, now: (() => { let t = 0; return () => (t += 1000); })() });
    const events = [];
    await manager.ensure(A, {}, (e) => events.push(e));
    const downloading = events.filter((e) => e.phase === "downloading").map((e) => e.percent);
    expect(downloading[0]).toBe(0);
    expect(Math.max(...downloading)).toBe(99);
    expect(nonDecreasing(collect(events))).toBe(true);
  });

  it("uma nova tentativa (yt-dlp renovado) não faz a barra voltar atrás", async () => {
    let attempt = 0;
    const good = okRun();
    const run = vi.fn(async (opts) => {
      if (attempt++ === 0) {
        opts.onProgress({ percent: 70 });
        throw new OnlineVideoError("forbidden", "HTTP Error 403");
      }
      opts.onProgress({ percent: 5 });
      return good(opts);
    });
    const { manager } = make({ run, now: (() => { let t = 0; return () => (t += 1000); })() });
    const events = [];
    await manager.ensure(A, {}, (e) => events.push(e));
    const percents = collect(events);
    expect(nonDecreasing(percents)).toBe(true);
    expect(Math.max(...percents.slice(0, -1))).toBeLessThan(100);
    expect(events.filter((e) => e.phase === "downloading").every((e) => e.percent >= 0)).toBe(true);
    expect(percents.filter((p) => p >= 69 && p < 100).length).toBeGreaterThan(0);
  });

  it("o erro não carrega percentual enganoso", async () => {
    const run = vi.fn(async () => {
      throw new OnlineVideoError("private", "x");
    });
    const { manager } = make({ run });
    const events = [];
    await manager.ensure(A, {}, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ phase: "error", percent: 0, kind: "private" });
  });
});

describe("progresso", () => {
  it("não inunda o renderer: eventos de progresso são espaçados", async () => {
    let t = 0;
    const run = vi.fn(async (opts) => {
      for (let i = 1; i <= 100; i++) {
        t += 10; // 10 ms entre eventos
        opts.onProgress({ percent: i / 2, downloaded: i, total: 100, speed: 1, eta: 1 });
      }
      return okRun()(opts);
    });
    const { manager } = make({ run, now: () => t });
    const downloading = [];
    await manager.ensure(A, {}, (e) => {
      if (e.phase === "downloading" && e.percent > 0) downloading.push(e);
    });
    // 100 eventos em 1 s, com 250 ms de intervalo mínimo: cerca de 4 chegam ao renderer
    expect(downloading.length).toBeGreaterThanOrEqual(3);
    expect(downloading.length).toBeLessThanOrEqual(6);
  });

  it("ouvinte que lança não derruba o download", async () => {
    const { manager } = make();
    const res = await manager.ensure(A, {}, () => {
      throw new Error("janela fechada");
    });
    expect(res.ok).toBe(true);
  });

  it("emite a fase 'error' com o tipo quando falha", async () => {
    const run = vi.fn(async () => {
      throw new OnlineVideoError("geo", "x");
    });
    const { manager } = make({ run });
    const events = [];
    await manager.ensure(A, {}, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ phase: "error", kind: "geo" });
  });
});

describe("stream (tocar já, enquanto baixa uma vez só)", () => {
  const GV = "https://rr1---sn-x.googlevideo.com/videoplayback";
  const VURL = `${GV}?kind=video`;
  const AURL = `${GV}?kind=audio`;
  const bytes = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251));

  /** Um YouTube falso (só os pedaços em memória) e um ffmpeg falso, ligados a um gerenciador de verdade. */
  function makeStream(overrides = {}) {
    const video = bytes(6000, 1);
    const audio = bytes(2000, 2);
    const log = [];
    const gate = overrides.gate; // {promise}: segura os pedaços até o teste soltar
    const fetchRange = vi.fn(async (url, start, end, { signal } = {}) => {
      log.push({ kind: url === VURL ? "video" : "audio", start, end });
      if (gate) {
        // como o HTTP de verdade: cancelar interrompe o pedido em voo
        await Promise.race([
          gate.promise,
          new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new OnlineVideoError("cancelled", "Cancelado")))),
        ]);
      }
      if (overrides.fetchFails) throw overrides.fetchFails;
      const src = url === VURL ? video : audio;
      return { data: Buffer.from(src.subarray(start, end + 1)), total: src.length };
    });
    const resolve = overrides.resolve ?? vi.fn(async ({ id }) => {
      if (overrides.failFor?.includes(id)) return noDirectLinks();
      return {
        video: { url: VURL, size: video.length, height: 1080, vcodec: "avc1.640028", ext: "mp4" },
        audio: { url: AURL, size: audio.length, acodec: "mp4a.40.2", ext: "m4a" },
        muxed: false,
        duration: 60,
        expiresAt: 1789960552000,
      };
    });
    const mux = overrides.mux ?? vi.fn(async ({ video: v, audio: a, out }) => {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.concat([fs.readFileSync(v), fs.readFileSync(a)]));
      return { file: out, size: fs.statSync(out).size };
    });
    const made = make({ resolve, fetchRange, mux, ...overrides.cfg });
    return { ...made, resolve, fetchRange, mux, log, video, audio };
  }

  const read = async (served) => Buffer.from(await new Response(served.body).arrayBuffer());

  it("marca stream ativo apenas no retrato local de incidente", async () => {
    const gate = deferred();
    const { manager } = makeStream({ gate });
    await manager.stream(A);

    const snapshot = manager.diagnosticSnapshot();
    expect(snapshot).toMatchObject({
      online_video_active_count: 1,
      online_video_session_count: 1,
      online_video_streaming: 1,
      online_video_foreground_running: 0,
      online_video_background_running: 0,
    });
    expect(snapshot.online_video_jobs).toEqual([
      expect.objectContaining({ priority: "foreground", lane: "streaming", phase: "downloading", played: true, age_bucket: "lt_10s" }),
    ]);

    gate.resolve();
    await manager.ensure(A);
  });

  it("devolve endereços do próprio app (nunca o link do YouTube) e a janela já lê o vídeo por eles", async () => {
    const { manager, video, audio } = makeStream();
    const res = await manager.stream(A);
    expect(res).toMatchObject({
      ok: true,
      id: A,
      cached: false,
      muxed: false,
      duration: 60,
      video: { url: `louvorja://onlinestream/${A}/video`, height: 1080 },
      audio: { url: `louvorja://onlinestream/${A}/audio` },
    });
    expect(JSON.stringify(res)).not.toContain("googlevideo");
    expect((await read(manager.serveStream(A, "video", "bytes=0-99"))).equals(video.subarray(0, 100))).toBe(true);
    expect((await read(manager.serveStream(A, "audio", "bytes=100-199"))).equals(audio.subarray(100, 200))).toBe(true);
  });

  it("baixa cada trilha uma vez só, por mais janelas que leiam", async () => {
    const { manager, log, video } = makeStream();
    await manager.stream(A);
    const readers = await Promise.all(
      [1, 2, 3, 4].map(() => read(manager.serveStream(A, "video", "bytes=0-5999")))
    );
    for (const r of readers) expect(r.equals(video)).toBe(true);
    await manager.ensure(A); // espera o job
    expect(log.filter((r) => r.kind === "video")).toHaveLength(1);
    expect(log.filter((r) => r.kind === "audio")).toHaveLength(1);
  });

  it("quando as trilhas terminam, o ffmpeg só as junta e o MP4 entra no cache como um download normal", async () => {
    const { manager, mux, run, tools } = makeStream();
    await manager.stream(A);
    const done = await manager.ensure(A, {}, () => {}); // quem já pede o download se junta ao job
    expect(done).toMatchObject({ ok: true, id: A, url: `louvorja://onlinevideo/${A}.mp4`, cached: false });
    expect(mux).toHaveBeenCalledTimes(1);
    expect(mux.mock.calls[0][0]).toMatchObject({ ffmpeg: "/fake/ffmpeg" });
    expect(manager.store.has(A)).toBe(true);
    expect(fs.existsSync(path.join(dir, ".partial", A))).toBe(false);
    expect(run).not.toHaveBeenCalled(); // o yt-dlp nem entrou no download
    expect(tools.refreshYtdlp).not.toHaveBeenCalled();
  });

  it("o download em segundo plano de quem já toca se junta ao job, sem abrir outro nem baixar de novo", async () => {
    const { manager, run, log } = makeStream();
    await manager.stream(A);
    const events = [];
    const res = await manager.ensure(A, { priority: "background" }, (e) => events.push(e));
    expect(res.ok).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(log.filter((r) => r.kind === "video")).toHaveLength(1);
    expect(events.map((e) => e.phase)).toContain("done");
  });

  it("o progresso segue as fases de sempre e só sobe", async () => {
    const { manager } = makeStream();
    const events = [];
    await manager.stream(A);
    await manager.ensure(A, {}, (e) => events.push(e));
    const phases = events.map((e) => e.phase);
    expect(phases.indexOf("finalizing")).toBeGreaterThan(-1);
    expect(phases.at(-1)).toBe("done");
    const percents = events.filter((e) => typeof e.percent === "number").map((e) => e.percent);
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
  });

  it("dois pedidos do mesmo vídeo viram uma sessão só", async () => {
    const { manager, resolve, log } = makeStream();
    const [one, two] = await Promise.all([manager.stream(A), manager.stream(A)]);
    expect(one).toMatchObject({ ok: true });
    expect(two).toMatchObject({ ok: true });
    await manager.ensure(A);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(log.filter((r) => r.kind === "video")).toHaveLength(1);
  });

  it("pedir de novo com 'manter' marca o job para guardar o vídeo", async () => {
    const { manager } = makeStream();
    await manager.stream(A);
    await manager.stream(A, { keep: true });
    await manager.ensure(A);
    expect(manager.store.isKept(A)).toBe(true);
  });

  it("manter um vídeo que ainda baixa (tocar já) o guarda quando terminar", async () => {
    const { manager } = makeStream();
    await manager.stream(A);
    expect(manager.store.isKept(A)).toBe(false); // ainda não há arquivo
    expect(manager.keep(A)).toBe(true);
    await manager.ensure(A);
    expect(manager.store.isKept(A)).toBe(true);
  });

  it("vídeo que já está no disco: devolve o arquivo (os dois endereços iguais), sem procurar links", async () => {
    const { manager, resolve } = makeStream();
    await manager.ensure(A); // baixa e deixa no cache
    resolve.mockClear();
    const res = await manager.stream(A);
    expect(res).toMatchObject({
      ok: true,
      cached: true,
      muxed: true,
      video: { url: `louvorja://onlinevideo/${A}.mp4` },
      audio: { url: `louvorja://onlinevideo/${A}.mp4` },
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("vídeo formato único (com o som junto): uma trilha só, sem ffmpeg", async () => {
    const single = bytes(5000, 3);
    const resolve = vi.fn(async () => ({
      video: { url: VURL, size: single.length, height: 720 },
      audio: { url: VURL, size: single.length },
      muxed: true,
      duration: 30,
    }));
    const fetchRange = vi.fn(async (url, start, end) => ({ data: Buffer.from(single.subarray(start, end + 1)), total: single.length }));
    const mux = vi.fn();
    const { manager } = make({ resolve, fetchRange, mux });
    const res = await manager.stream(B);
    expect(res).toMatchObject({ ok: true, muxed: true });
    expect((await read(manager.serveStream(B, "audio", "bytes=0-99"))).equals(single.subarray(0, 100))).toBe(true);
    expect(await manager.ensure(B)).toMatchObject({ ok: true });
    expect(mux).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(dir, `${B}.mp4`)).equals(single)).toBe(true);
  });

  describe("recusas", () => {
    it("ID inválido não chega a lugar nenhum", async () => {
      const { manager, resolve, fetchRange } = makeStream();
      for (const bad of ["../x", "--exec=calc", "", null]) {
        expect(await manager.stream(bad)).toMatchObject({ ok: false, error: { kind: "invalid" } });
      }
      expect(resolve).not.toHaveBeenCalled();
      expect(fetchRange).not.toHaveBeenCalled();
    });

    it("plataforma sem suporte", async () => {
      const { manager, resolve } = makeStream({ cfg: { tools: fakeTools({ supported: false }) } });
      expect(await manager.stream(A)).toMatchObject({ ok: false, error: { kind: "unsupported" } });
      expect(resolve).not.toHaveBeenCalled();
    });

    it("sem as ferramentas instaladas: não instala por conta própria, quem pede cai no caminho normal", async () => {
      const tools = fakeTools({ ready: vi.fn(() => false) });
      const { manager, resolve } = makeStream({ cfg: { tools } });
      expect(await manager.stream(A)).toMatchObject({ ok: false, error: { kind: "tools" } });
      expect(resolve).not.toHaveBeenCalled();
      expect(tools.ensure).not.toHaveBeenCalled();
    });

    it("pouco espaço em disco: recusa antes de baixar qualquer byte", async () => {
      const { manager, fetchRange } = makeStream({ cfg: { freeBytes: async () => MIN_FREE_BYTES - 1 } });
      expect(await manager.stream(A)).toMatchObject({ ok: false, error: { kind: "disk" } });
      expect(fetchRange).not.toHaveBeenCalled();
    });

    it("vídeo removido, privado…: o erro do yt-dlp chega como resultado, sem renovar o yt-dlp", async () => {
      const resolve = vi.fn(async () => {
        throw new OnlineVideoError("private", "Private video");
      });
      const { manager, tools } = makeStream({ resolve });
      expect(await manager.stream(A)).toEqual({ ok: false, error: { kind: "private", message: "Private video" } });
      expect(tools.refreshYtdlp).not.toHaveBeenCalled();
    });

    it("erro inesperado do yt-dlp também vira resultado, nunca exceção", async () => {
      const resolve = vi.fn(async () => {
        throw new TypeError("boom");
      });
      const { manager } = makeStream({ resolve });
      expect(await manager.stream(A)).toMatchObject({ ok: false, error: { kind: "unknown", message: "boom" } });
    });

    it("serveStream só atende ID válido e as duas trilhas conhecidas", async () => {
      const { manager } = makeStream();
      await manager.stream(A);
      for (const [id, kind] of [["../x", "video"], [A, "other"], [A, "../../etc/passwd"], [B, "video"], [null, "video"]]) {
        expect(manager.serveStream(id, kind, "bytes=0-9")).toBeNull();
      }
    });
  });

  describe("o download (botão ou link novo) usa o mesmo caminho: uma cópia só, que o play já pode ler", () => {
    it("baixa pelas trilhas e entrega o MP4, sem o yt-dlp baixar nada", async () => {
      const { manager, run, resolve, video, audio } = makeStream();
      const res = await manager.ensure(A, { keep: true });
      expect(res).toMatchObject({ ok: true, id: A, url: `louvorja://onlinevideo/${A}.mp4`, cached: false });
      expect(run).not.toHaveBeenCalled();
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(path.join(dir, `${A}.mp4`)).equals(Buffer.concat([video, audio]))).toBe(true);
      expect(manager.store.isKept(A)).toBe(true);
    });

    it("vídeo só com formatos em fragmentos: o yt-dlp baixa, como antes", async () => {
      const { manager, run } = makeStream({ failFor: [A] });
      expect(await manager.ensure(A)).toMatchObject({ ok: true });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("o que é do próprio vídeo (privado, restrito…) falha sem tentar o yt-dlp por baixo", async () => {
      const resolve = vi.fn(async () => {
        throw new OnlineVideoError("private", "Vídeo privado");
      });
      const { manager, run } = makeStream({ resolve });
      expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "private" } });
      expect(run).not.toHaveBeenCalled();
    });

    it("mandar tocar no meio do download começa já, das trilhas que estão sendo baixadas", async () => {
      const gate = deferred();
      const { manager, resolve, video } = makeStream({ gate });
      const download = manager.ensure(A, { priority: "background", keep: true });
      const res = await manager.stream(A); // o download ainda nem recebeu o primeiro pedaço
      expect(res).toMatchObject({ ok: true, video: { url: `louvorja://onlinestream/${A}/video` } });
      expect(resolve).toHaveBeenCalledTimes(1); // os links foram descobertos uma vez só
      gate.resolve();
      const served = manager.serveStream(A, "video", "bytes=0-99");
      expect(served.status).toBe(206);
      expect(await read(served)).toEqual(video.subarray(0, 100));
      expect(await download).toMatchObject({ ok: true });
      expect(manager.store.isKept(A)).toBe(true);
    });

    it("mandar tocar um vídeo que ainda espera na fila de pré-downloads o tira da fila", async () => {
      const gate = deferred();
      const run = vi.fn(async (opts) => {
        await gate.promise;
        return okRun()(opts);
      });
      // B (só em fragmentos) segura a raia de pré-download; A espera na fila atrás dele.
      const { manager } = makeStream({ cfg: { run }, failFor: [B] });
      const first = manager.ensure(B, { priority: "background" });
      const queued = manager.ensure(A, { priority: "background" });
      const res = await Promise.race([manager.stream(A), new Promise((r) => setTimeout(() => r("preso"), 400))]);
      expect(res).toMatchObject({ ok: true, video: { url: `louvorja://onlinestream/${A}/video` } });
      gate.resolve();
      await Promise.all([first, queued]);
    });

    it("a cópia em trilhas de um pré-download que ninguém tocou some quando o MP4 fica pronto", async () => {
      const { manager } = makeStream();
      await manager.ensure(A);
      await new Promise((r) => setTimeout(r, 50));
      expect(manager.serveStream(A, "video", "bytes=0-9")).toBeNull();
      expect(fs.existsSync(path.join(dir, ".stream", A))).toBe(false);
      expect(manager.store.has(A)).toBe(true);
    });

    it("mas se o operador mandou tocar, as janelas seguem lendo dela depois de o MP4 ficar pronto", async () => {
      const gate = deferred();
      const { manager, video } = makeStream({ gate });
      const download = manager.ensure(A);
      await manager.stream(A);
      gate.resolve();
      await download;
      expect(manager.store.has(A)).toBe(true);
      expect(await read(manager.serveStream(A, "video", "bytes=0-9"))).toEqual(video.subarray(0, 10));
    });

    it("o progresso só sobe e traz o andamento das trilhas", async () => {
      let t = 0;
      const { manager } = makeStream({ cfg: { now: () => (t += 300) } });
      const events = [];
      await manager.ensure(A, {}, (e) => events.push(e));
      const phases = events.map((e) => e.phase);
      expect(phases[0]).toBe("queued");
      expect(phases).toContain("downloading");
      expect(phases.at(-1)).toBe("done");
      const percents = events.map((e) => e.percent);
      for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
      expect(events.some((e) => e.downloaded > 0 && e.total > 0)).toBe(true);
    });

    it("na primeira vez, o vídeo usa a parte da barra que sobra depois das ferramentas", async () => {
      let ready = false;
      const paths = { ytdlp: "/fake/yt-dlp", ffmpeg: "/fake/ffmpeg" };
      const tools = fakeTools({
        ready: vi.fn(() => ready),
        paths: vi.fn(() => paths),
        ensure: vi.fn(async () => {
          ready = true;
          return paths;
        }),
      });
      let t = 0;
      const { manager } = makeStream({ cfg: { tools, now: () => (t += 300) } });
      const events = [];
      const res = await manager.ensure(A, {}, (e) => events.push(e));
      expect(res).toMatchObject({ ok: true, installedTools: true });
      const downloading = events.filter((e) => e.phase === "downloading");
      expect(downloading.length).toBeGreaterThan(1);
      expect(downloading.every((e) => e.percent >= 25)).toBe(true);
      // Trilhas completas = 95% do vídeo, na parte que sobra da barra: 25 + 95 × 74 ÷ 99 ≈ 96.
      expect(Math.max(...downloading.map((e) => e.percent))).toBe(96);
    });

    it("cancelar no meio: termina como cancelado e as trilhas pela metade somem", async () => {
      const gate = deferred();
      const { manager } = makeStream({ gate });
      const download = manager.ensure(A);
      await manager.stream(A); // abre a sessão
      manager.cancel(A);
      expect(await download).toMatchObject({ ok: false, error: { kind: "cancelled" } });
      await new Promise((r) => setTimeout(r, 50));
      expect(manager.serveStream(A, "video", "bytes=0-9")).toBeNull();
      expect(fs.existsSync(path.join(dir, ".stream", A))).toBe(false);
      expect(manager.store.has(A)).toBe(false);
    });

    it("quem manda tocar um download que falha antes de abrir as trilhas recebe o motivo", async () => {
      const resolve = vi.fn(async () => {
        throw new OnlineVideoError("private", "Vídeo privado");
      });
      const { manager } = makeStream({ resolve });
      const download = manager.ensure(A);
      expect(await manager.stream(A)).toMatchObject({ ok: false, error: { kind: "private" } });
      await download;
    });
  });

  describe("já havia um download pelo yt-dlp (vídeo só com formatos em fragmentos)", () => {
    it("não há trilha para ler antes do fim: avisa 'busy' e o torna o urgente", async () => {
      const gate = deferred();
      const run = vi.fn(async (opts) => {
        await gate.promise;
        return okRun()(opts);
      });
      const resolve = vi.fn(noDirectLinks);
      const { manager } = makeStream({ cfg: { run }, resolve });
      const background = manager.ensure(A, { priority: "background" });
      await Promise.resolve();
      const res = await manager.stream(A);
      expect(res).toMatchObject({ ok: false, error: { kind: "busy" } });
      expect(resolve).toHaveBeenCalledTimes(1); // só a do próprio download: o play não procura de novo
      gate.resolve();
      expect(await background).toMatchObject({ ok: true });
    });
  });

  describe("quando algo dá errado no meio", () => {
    it("link vencido (403): quem espera o download recebe o erro, e a sessão some (nada pela metade)", async () => {
      const { manager } = makeStream({ fetchFails: new OnlineVideoError("forbidden", "HTTP 403") });
      await manager.stream(A);
      const res = await manager.ensure(A);
      expect(res).toMatchObject({ ok: false, error: { kind: "forbidden" } });
      expect(manager.serveStream(A, "video", "bytes=0-9")).toBeNull();
      expect(manager.store.has(A)).toBe(false);
      expect(fs.existsSync(path.join(dir, ".stream", A))).toBe(false);
    });

    it("o ffmpeg falha ao juntar: nada entra no cache, e o erro chega", async () => {
      const mux = vi.fn(async () => {
        throw new OnlineVideoError("format", "ffmpeg: Invalid data");
      });
      const { manager } = makeStream({ mux });
      await manager.stream(A);
      expect(await manager.ensure(A)).toMatchObject({ ok: false, error: { kind: "format" } });
      expect(manager.store.has(A)).toBe(false);
      expect(fs.existsSync(path.join(dir, ".partial", A)) && fs.readdirSync(path.join(dir, ".partial", A)).length).toBeFalsy();
    });

    it("cancelar para o download, acorda quem lê e não deixa trilhas em disco", async () => {
      const gate = deferred();
      const { manager } = makeStream({ gate });
      await manager.stream(A);
      const reading = read(manager.serveStream(A, "video", "bytes=0-99")).then(() => null, (e) => e);
      const job = manager.ensure(A);
      expect(manager.cancel(A)).toBe(true);
      expect(await job).toMatchObject({ ok: false, error: { kind: "cancelled" } });
      expect(await reading).toBeTruthy();
      gate.resolve();
      expect(manager.serveStream(A, "video", "bytes=0-9")).toBeNull();
      expect((await manager.status()).active).toEqual([]);
    });

    it("cancelar enquanto os links ainda chegam: 'cancelled', sem sessão nem arquivo", async () => {
      const resolve = vi.fn(
        ({ signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(new OnlineVideoError("cancelled", "Cancelado")))
          )
      );
      const { manager, fetchRange } = makeStream({ resolve });
      const pending = manager.stream(A);
      await Promise.resolve();
      expect(manager.cancel(A)).toBe(true);
      expect(await pending).toMatchObject({ ok: false, error: { kind: "cancelled" } });
      expect(fetchRange).not.toHaveBeenCalled();
    });

    it("cancelar no instante em que os links chegam vale: nada é aberto nem baixado", async () => {
      const { manager, fetchRange } = makeStream(); // este yt-dlp falso nem olha o sinal de cancelamento
      const opening = manager.stream(A);
      await Promise.resolve();
      manager.cancel(A);
      expect(await opening).toMatchObject({ ok: false, error: { kind: "cancelled" } });
      expect(fetchRange).not.toHaveBeenCalled();
      expect((await manager.status()).active).toEqual([]);
      expect(manager.serveStream(A, "video", "bytes=0-9")).toBeNull();
      expect(fs.existsSync(path.join(dir, ".stream", A))).toBe(false);
    });

    it("remover o vídeo no meio do download cancela, apaga as trilhas e não deixa cache", async () => {
      const gate = deferred();
      const { manager } = makeStream({ gate });
      await manager.stream(A);
      const job = manager.ensure(A);
      await manager.remove(A);
      expect(await job).toMatchObject({ ok: false, error: { kind: "cancelled" } });
      gate.resolve();
      expect(manager.store.has(A)).toBe(false);
      expect(manager.serveStream(A, "video", "bytes=0-9")).toBeNull();
    });

    it("cancelar depois de cancelado, ou de um vídeo que não baixa, não quebra nada", async () => {
      const { manager } = makeStream();
      expect(manager.cancel(A)).toBe(false);
    });
  });

  describe("limpeza das trilhas em disco", () => {
    it("começar outro vídeo NÃO apaga na hora as trilhas do que já terminou: a troca ainda não chegou às janelas", async () => {
      // O aviso para as janelas trocarem de vídeo só sai DEPOIS que os links do novo resolvem
      // (stream() ainda está resolvendo B aqui) — apagar o arquivo de A agora rasga o vídeo
      // debaixo de quem ainda está vendo, e é isto que o operador sentiu como "aperto em outro
      // vídeo e buga".
      const { manager } = makeStream();
      await manager.stream(A);
      await manager.ensure(A); // A terminou e virou MP4
      expect(manager.serveStream(A, "video", "bytes=0-9")).not.toBeNull(); // ainda serve: a janela pode estar pausada
      await manager.stream(B);
      expect(manager.serveStream(A, "video", "bytes=0-9")).not.toBeNull();
      expect(fs.existsSync(path.join(dir, ".stream", A))).toBe(true);
    });

    it("as trilhas do vídeo anterior só saem sozinhas depois de ficarem ociosas", async () => {
      // Começa em 1 (não 0): `finishedAt` vira falsy com o relógio parado em zero e o sweep
      // trataria a sessão como "ainda não terminou", mascarando o teste.
      let clock = 1;
      const { manager } = makeStream({ cfg: { now: () => clock } });
      await manager.stream(A);
      await manager.ensure(A); // A terminou e virou MP4
      clock += SESSION_IDLE_MS + 1;
      await manager.stream(B); // a varredura roda aqui; A já está ocioso há tempo suficiente
      expect(manager.serveStream(A, "video", "bytes=0-9")).toBeNull();
      expect(fs.existsSync(path.join(dir, ".stream", A))).toBe(false);
    });

    it("ao abrir o app, o que sobrou de uma sessão anterior é apagado", async () => {
      fs.mkdirSync(path.join(dir, ".stream", A), { recursive: true });
      fs.writeFileSync(path.join(dir, ".stream", A, "video.mp4"), "x");
      const { manager } = makeStream();
      await manager.init();
      expect(fs.existsSync(path.join(dir, ".stream"))).toBe(false);
    });

    it("as trilhas não aparecem na lista de vídeos baixados nem contam na cota", async () => {
      const gate = deferred();
      const { manager } = makeStream({ gate });
      await manager.stream(A);
      expect(await manager.list()).toEqual([]);
      gate.resolve();
      await manager.ensure(A);
      expect((await manager.list()).map((v) => v.id)).toEqual([A]);
    });
  });

  it("conta como transferência (a manutenção das ferramentas espera) mas não ocupa a fila de download", async () => {
    const gate = deferred();
    const { manager } = makeStream({ gate });
    await manager.stream(A);
    // um download de OUTRO vídeo, na raia urgente, não fica esperando atrás do "tocar já"
    const phases = [];
    const other = manager.ensure(B, { priority: "foreground" }, (e) => phases.push(e.phase));
    await new Promise((r) => setTimeout(r, 300));
    expect(phases).toContain("downloading");
    gate.resolve();
    expect(await other).toMatchObject({ ok: true });
    await manager.ensure(A);
  });
});
