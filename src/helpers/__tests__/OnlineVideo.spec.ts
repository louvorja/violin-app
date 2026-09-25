import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  platform: { isDesktop: true, onlineVideo: null as any },
  prefs: {} as Record<string, unknown>,
  track: vi.fn(),
}));

vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in h.prefs ? h.prefs[key] : fallback) },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: h.track } }));

import {
  actionForFailure,
  cancel,
  DEFAULT_MAX_HEIGHT,
  downloadAvailable,
  downloadEnabled,
  ensure,
  isProgressiveUrl,
  isDownloaded,
  keepFile,
  listFiles,
  MAX_HEIGHTS,
  maxHeight,
  messageKeyForDownloadFailure,
  messageKeyForFailure,
  messageKeyForStreamFailure,
  normalizeMaxHeight,
  removeFile,
  stream,
  videoIdFromUrl,
} from "@/helpers/OnlineVideo";
import { KEYS } from "@/constants/UserDataKeys";

const ID = "T8YHfGrk3ok";
const K = KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION;

function fakeApi(overrides: Record<string, unknown> = {}) {
  const listeners = new Set<(p: any) => void>();
  return {
    ensure: vi.fn(async () => ({
      ok: true,
      id: ID,
      url: `louvorja://onlinevideo/${ID}.mp4`,
      size: 5,
      cached: false,
    })),
    cancel: vi.fn(async () => true),
    onProgress: vi.fn((cb: (p: any) => void) => {
      listeners.add(cb);
      return vi.fn(() => listeners.delete(cb));
    }),
    emit: (p: any) => listeners.forEach((cb) => cb(p)),
    listeners,
    ...overrides,
  };
}

beforeEach(() => {
  h.platform.isDesktop = true;
  h.platform.onlineVideo = fakeApi();
  h.prefs = {};
  h.track.mockClear();
});

describe("videoIdFromUrl", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s`],
    [`https://youtu.be/${ID}`],
    [`https://www.youtube.com/embed/${ID}?autoplay=1&rel=0&controls=0`],
    [`https://www.youtube.com/v/${ID}`],
  ])("acha o ID em %s", (url) => {
    expect(videoIdFromUrl(url)).toBe(ID);
  });

  it.each([
    ["https://vimeo.com/123456789"],
    ["https://www.youtube.com/watch?v=curto"],
    ["https://www.youtube.com/"],
    ["não é url"],
    [""],
  ])("devolve null para %s", (url) => {
    expect(videoIdFromUrl(url)).toBeNull();
  });

  it("aguenta entrada que não é texto", () => {
    expect(videoIdFromUrl(undefined)).toBeNull();
    expect(videoIdFromUrl(null)).toBeNull();
    expect(videoIdFromUrl(12345 as unknown as string)).toBeNull();
  });
});

describe("política de falha", () => {
  it("cancelamento do operador é silencioso", () => {
    expect(actionForFailure("cancelled")).toBe("silent");
  });

  it.each(["age", "private", "geo", "unavailable"])(
    "%s: o vídeo é o problema — só avisa, e nada vai para o telão",
    (kind) => {
      expect(actionForFailure(kind)).toBe("error");
    }
  );

  it.each([
    "tool",
    "network",
    "bot",
    "forbidden",
    "format",
    "unknown",
    "disk",
    "live",
    "unsupported",
  ])("%s: o problema é nosso (ou é transmissão ao vivo) — cai no player do YouTube", (kind) => {
    expect(actionForFailure(kind)).toBe("embed");
  });

  it("todo erro que o main pode devolver tem uma ação definida", () => {
    const kinds = [
      "invalid",
      "unsupported",
      "tool",
      "network",
      "cancelled",
      "age",
      "private",
      "geo",
      "live",
      "bot",
      "unavailable",
      "disk",
      "format",
      "forbidden",
      "unknown",
    ];
    for (const kind of kinds)
      expect(["silent", "error", "embed"]).toContain(actionForFailure(kind));
  });
});

describe("mensagens ao operador existem nos dois idiomas", () => {
  const pt = JSON.parse(readFileSync("src/lang/pt.json", "utf8"));
  const es = JSON.parse(readFileSync("src/lang/es.json", "utf8"));
  const resolve = (obj: any, key: string) => key.split(".").reduce((o, k) => o?.[k], obj);

  const keys = [
    ...["age", "private", "geo", "unavailable", "tool", "network", "unknown"].map(
      messageKeyForFailure
    ),
    "online_video.preparing",
    "online_video.phase.tools",
    "online_video.phase.queued",
    "online_video.phase.downloading",
    "online_video.phase.finalizing",
    "options.videos.download",
    "options.videos.download_hint",
    "options.videos.max_height",
    "options.videos.cache_size",
    "options.videos.cache_empty",
    "options.videos.cache_clear",
    "options.videos.cache_clear_confirm",
    messageKeyForDownloadFailure("network"),
    "online_video.download.start",
    "online_video.download.done",
    "online_video.download.remove",
    "online_video.download.cancel",
    "online_video.download.confirm_remove",
    "online_video.download.summary",
    "online_video.download.download_all",
    "online_video.download.remove_all",
    "online_video.download.confirm_remove_all",
    messageKeyForStreamFailure("network"),
  ];

  // Cognatos que se escrevem igual nos dois idiomas.
  const SAME_IN_BOTH = new Set(["online_video.phase.finalizing"]);

  it.each([...new Set(keys)])("%s", (key) => {
    expect(typeof resolve(pt, key), `pt ${key}`).toBe("string");
    expect(typeof resolve(es, key), `es ${key}`).toBe("string");
    expect(resolve(pt, key).length).toBeGreaterThan(3);
    if (!SAME_IN_BOTH.has(key)) expect(resolve(es, key)).not.toBe(resolve(pt, key));
  });

  it("o aviso de reserva diz que o app usa o player do YouTube, sem falar de anúncios", () => {
    expect(resolve(pt, messageKeyForFailure("network"))).toMatch(/player do YouTube/);
    expect(resolve(es, messageKeyForFailure("network"))).toMatch(/reproductor de YouTube/);
    expect(resolve(pt, messageKeyForFailure("network"))).not.toMatch(/anúncios/);
    expect(resolve(es, messageKeyForFailure("network"))).not.toMatch(/anuncios/);
  });

  it("baixar de antemão não promete o player do YouTube, que não existe nesse caminho", () => {
    expect(resolve(pt, messageKeyForDownloadFailure("network"))).not.toMatch(/YouTube|anúncios/);
    expect(resolve(es, messageKeyForDownloadFailure("network"))).not.toMatch(/YouTube|anuncios/);
    expect(messageKeyForDownloadFailure("private")).toBe("online_video.errors.private");
    expect(messageKeyForDownloadFailure("tool")).toBe("online_video.errors.download");
  });

  it("o aviso do 'tocar já' não fala em baixar (nada foi baixado) nem em anúncios, e diz que usa o player do YouTube", () => {
    expect(resolve(pt, messageKeyForStreamFailure("network"))).not.toMatch(/baixar/i);
    expect(resolve(es, messageKeyForStreamFailure("network"))).not.toMatch(/descargar/i);
    expect(resolve(pt, messageKeyForStreamFailure("network"))).toMatch(/player do YouTube/);
    expect(resolve(es, messageKeyForStreamFailure("network"))).toMatch(/reproductor de YouTube/);
    expect(resolve(pt, messageKeyForStreamFailure("network"))).not.toMatch(/anúncios/);
    expect(resolve(es, messageKeyForStreamFailure("network"))).not.toMatch(/anuncios/);
    expect(messageKeyForStreamFailure("private")).toBe("online_video.errors.private");
    expect(messageKeyForStreamFailure("tool")).toBe("online_video.errors.stream");
  });

  it("a opção de baixar descreve o que ela faz: sem anúncios, sem esperar o fim do download e já ao adicionar o link", () => {
    for (const lang of [pt, es]) {
      const hint = resolve(lang, "options.videos.download_hint");
      expect(hint).toMatch(/sin anuncios|sem anúncios/);
      expect(hint).toMatch(/sin esperar|sem esperar/);
      expect(hint).toMatch(/ya empieza|já começa/);
    }
  });

  it("cada erro do próprio vídeo tem a sua mensagem, e o resto usa a de reserva", () => {
    expect(messageKeyForFailure("private")).toBe("online_video.errors.private");
    expect(messageKeyForFailure("age")).toBe("online_video.errors.age");
    expect(messageKeyForFailure("tool")).toBe("online_video.errors.fallback");
    expect(messageKeyForFailure("live")).toBe("online_video.errors.fallback");
  });
});

describe("altura máxima", () => {
  it("só aceita as alturas oferecidas e cai em 1080", () => {
    expect([...MAX_HEIGHTS]).toEqual([480, 720, 1080]);
    for (const h2 of MAX_HEIGHTS) expect(normalizeMaxHeight(h2)).toBe(h2);
    for (const bad of [0, 360, 1440, 4320, -1, NaN, "abc", null, undefined, "1080p"]) {
      expect(normalizeMaxHeight(bad)).toBe(DEFAULT_MAX_HEIGHT);
    }
    expect(normalizeMaxHeight("720")).toBe(720); // a preferência pode ter sido salva como texto
  });

  it("lê a preferência do usuário", () => {
    expect(maxHeight()).toBe(1080);
    h.prefs[K.MAX_HEIGHT] = 720;
    expect(maxHeight()).toBe(720);
    h.prefs[K.MAX_HEIGHT] = 999;
    expect(maxHeight()).toBe(1080);
  });
});

describe("downloadEnabled", () => {
  it("liga por padrão no desktop com o bridge presente", () => {
    expect(downloadEnabled()).toBe(true);
  });

  it("o operador pode desligar", () => {
    h.prefs[K.DOWNLOAD] = false;
    expect(downloadEnabled()).toBe(false);
    h.prefs[K.DOWNLOAD] = true;
    expect(downloadEnabled()).toBe(true);
  });

  it("no navegador nunca baixa", () => {
    h.platform.isDesktop = false;
    expect(downloadEnabled()).toBe(false);
  });

  it("sem o bridge do Electron (main antigo) não baixa", () => {
    h.platform.onlineVideo = null;
    expect(downloadEnabled()).toBe(false);
  });
});

describe("ensure", () => {
  it("devolve o resultado do main e registra a telemetria de sucesso", async () => {
    const res = await ensure(ID);
    expect(res).toMatchObject({ ok: true, id: ID });
    expect(h.platform.onlineVideo.ensure).toHaveBeenCalledWith(ID, {
      maxHeight: 1080,
      priority: "foreground",
      keep: false,
    });
    expect(h.track).toHaveBeenCalledWith(
      "online_video_download_requested",
      expect.objectContaining({ video_id: ID })
    );
    expect(h.track).toHaveBeenCalledWith(
      "online_video_download_ready",
      expect.objectContaining({ video_id: ID, cached: false })
    );
  });

  it("pré-download: pede a raia de segundo plano e a guarda no disco", async () => {
    await ensure(ID, undefined, { background: true, keep: true });
    expect(h.platform.onlineVideo.ensure).toHaveBeenCalledWith(ID, {
      maxHeight: 1080,
      priority: "background",
      keep: true,
    });
    expect(h.track).toHaveBeenCalledWith(
      "online_video_download_requested",
      expect.objectContaining({ background: true, keep: true })
    );
  });

  it("envia a altura escolhida pelo operador", async () => {
    h.prefs[K.MAX_HEIGHT] = 720;
    await ensure(ID);
    expect(h.platform.onlineVideo.ensure).toHaveBeenCalledWith(ID, {
      maxHeight: 720,
      priority: "foreground",
      keep: false,
    });
  });

  it("repassa só o progresso do vídeo pedido", async () => {
    const api = fakeApi({
      ensure: vi.fn(async () => {
        api.emit({ id: "outroVideo11", phase: "downloading", percent: 10 });
        api.emit({ id: ID, phase: "downloading", percent: 40 });
        return { ok: true, id: ID, url: "u", size: 1, cached: false };
      }),
    });
    h.platform.onlineVideo = api;
    const seen: number[] = [];
    await ensure(ID, (p) => seen.push(p.percent));
    expect(seen).toEqual([40]);
  });

  it("solta o ouvinte de progresso quando termina, dê certo ou não", async () => {
    const api = fakeApi();
    h.platform.onlineVideo = api;
    await ensure(ID, () => {});
    expect(api.listeners.size).toBe(0);

    const failing = fakeApi({
      ensure: vi.fn(async () => {
        throw new Error("IPC caiu");
      }),
    });
    h.platform.onlineVideo = failing;
    await ensure(ID, () => {});
    expect(failing.listeners.size).toBe(0);
  });

  it("não assina o progresso quando ninguém quer", async () => {
    const api = fakeApi();
    h.platform.onlineVideo = api;
    await ensure(ID);
    expect(api.onProgress).not.toHaveBeenCalled();
  });

  it("nunca rejeita: falha do IPC vira erro 'unknown' (que cai no player do YouTube)", async () => {
    h.platform.onlineVideo = fakeApi({
      ensure: vi.fn(async () => {
        throw new Error("Error invoking remote method");
      }),
    });
    const res = await ensure(ID);
    expect(res).toEqual({
      ok: false,
      error: { kind: "unknown", message: "Error invoking remote method" },
    });
    expect(actionForFailure((res as any).error.kind)).toBe("embed");
  });

  it("registra falha com o tipo e a ação, exceto cancelamento (não é falha)", async () => {
    h.platform.onlineVideo = fakeApi({
      ensure: vi.fn(async () => ({ ok: false, error: { kind: "private", message: "x" } })),
    });
    await ensure(ID);
    expect(h.track).toHaveBeenCalledWith(
      "online_video_download_failed",
      expect.objectContaining({ kind: "private", action: "error" })
    );

    h.track.mockClear();
    h.platform.onlineVideo = fakeApi({
      ensure: vi.fn(async () => ({ ok: false, error: { kind: "cancelled", message: "x" } })),
    });
    await ensure(ID);
    expect(h.track).not.toHaveBeenCalledWith("online_video_download_failed", expect.anything());
  });

  it("sem bridge devolve 'unsupported' em vez de estourar", async () => {
    h.platform.onlineVideo = null;
    expect(await ensure(ID)).toMatchObject({ ok: false, error: { kind: "unsupported" } });
  });
});

describe("downloadAvailable", () => {
  it("existe no desktop com o bridge, mesmo com o download automático desligado", () => {
    h.prefs[K.DOWNLOAD] = false;
    expect(downloadAvailable()).toBe(true);
    expect(downloadEnabled()).toBe(false);
  });

  it("não existe no navegador nem sem o bridge", () => {
    h.platform.isDesktop = false;
    expect(downloadAvailable()).toBe(false);
    h.platform.isDesktop = true;
    h.platform.onlineVideo = null;
    expect(downloadAvailable()).toBe(false);
  });
});

describe("vídeos no disco", () => {
  const files = [
    { id: ID, size: 10, usedAt: 1, kept: true },
    { id: "outroVideo11", size: 20, usedAt: 2, kept: false },
  ];

  it("lista o que o main devolve", async () => {
    h.platform.onlineVideo = fakeApi({ list: vi.fn(async () => files) });
    expect(await listFiles()).toEqual(files);
  });

  it("lista vazia sem bridge, com resposta estranha ou com o IPC falhando", async () => {
    h.platform.onlineVideo = null;
    expect(await listFiles()).toEqual([]);
    h.platform.onlineVideo = fakeApi({ list: vi.fn(async () => null) });
    expect(await listFiles()).toEqual([]);
    h.platform.onlineVideo = fakeApi({
      list: vi.fn(async () => Promise.reject(new Error("main saiu"))),
    });
    expect(await listFiles()).toEqual([]);
  });

  it("isDownloaded confere pelo ID e vale zero fora do desktop", async () => {
    h.platform.onlineVideo = fakeApi({
      has: vi.fn(async (id: string) => id === ID),
      list: vi.fn(),
    });
    expect(await isDownloaded(ID)).toBe(true);
    expect(await isDownloaded("zzzzzzzzzzz")).toBe(false);
    expect(h.platform.onlineVideo.has).toHaveBeenCalledWith(ID);
    expect(h.platform.onlineVideo.list).not.toHaveBeenCalled();
    h.platform.isDesktop = false;
    expect(await isDownloaded(ID)).toBe(false);
  });

  it("isDownloaded trata falha do IPC e resposta inválida como ausência de cache", async () => {
    h.platform.onlineVideo = fakeApi({ has: vi.fn(async () => "yes") });
    expect(await isDownloaded(ID)).toBe(false);
    h.platform.onlineVideo = fakeApi({
      has: vi.fn(async () => {
        throw new Error("main saiu");
      }),
    });
    expect(await isDownloaded(ID)).toBe(false);
  });

  it("keepFile diz se o main guardou, sem estourar", async () => {
    h.platform.onlineVideo = fakeApi({ keep: vi.fn(async () => true) });
    expect(await keepFile(ID)).toBe(true);
    expect(h.platform.onlineVideo.keep).toHaveBeenCalledWith(ID);
    h.platform.onlineVideo = fakeApi({ keep: vi.fn(async () => false) });
    expect(await keepFile(ID)).toBe(false);
    h.platform.onlineVideo = fakeApi({ keep: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect(await keepFile(ID)).toBe(false);
    h.platform.onlineVideo = null;
    expect(await keepFile(ID)).toBe(false);
  });

  it("removeFile pede ao main e informa se a remoção foi concluída", async () => {
    h.platform.onlineVideo = fakeApi({ remove: vi.fn(async () => true) });
    expect(await removeFile(ID)).toBe(true);
    expect(h.platform.onlineVideo.remove).toHaveBeenCalledWith(ID);
    h.platform.onlineVideo = fakeApi({ remove: vi.fn(async () => Promise.reject(new Error("x"))) });
    await expect(removeFile(ID)).resolves.toBe(false);
    h.platform.onlineVideo = null;
    await expect(removeFile(ID)).resolves.toBe(false);
  });
});

describe("cancel", () => {
  it("pede ao main para cancelar aquele vídeo", () => {
    cancel(ID);
    expect(h.platform.onlineVideo.cancel).toHaveBeenCalledWith(ID);
  });

  it("sem bridge não faz nada", () => {
    h.platform.onlineVideo = null;
    expect(() => cancel(ID)).not.toThrow();
  });
});

describe("isProgressiveUrl", () => {
  it("reconhece só o endereço do vídeo que ainda baixa (lido por pedaços, sem XHR)", () => {
    expect(isProgressiveUrl(`louvorja://onlinestream/${ID}/video`)).toBe(true);
    expect(isProgressiveUrl(`louvorja://onlinestream/${ID}/audio`)).toBe(true);
    for (const no of [
      `louvorja://onlinevideo/${ID}.mp4`, // já baixado: outro caminho
      "https://rr1.googlevideo.com/videoplayback",
      "https://www.youtube.com/watch?v=T8YHfGrk3ok",
      "blob:https://x/abc",
      "louvorja://files/musics/a.opus",
      "",
      null,
      undefined,
    ]) {
      expect(isProgressiveUrl(no as string)).toBe(false);
    }
  });
});

describe("stream", () => {
  const streams = {
    ok: true,
    id: ID,
    video: { url: `louvorja://onlinestream/${ID}/video`, height: 1080 },
    audio: { url: `louvorja://onlinestream/${ID}/audio` },
    muxed: false,
    duration: 235,
  };

  it("pede ao main com a altura escolhida e devolve a resposta", async () => {
    h.platform.onlineVideo = fakeApi({ stream: vi.fn(async () => streams) });
    h.prefs[K.MAX_HEIGHT] = 720;
    expect(await stream(ID)).toEqual(streams);
    expect(h.platform.onlineVideo.stream).toHaveBeenCalledWith(ID, { maxHeight: 720 });
    expect(h.track).toHaveBeenCalledWith(
      "online_video_stream_resolved",
      expect.objectContaining({ video_id: ID, height: 1080, muxed: false })
    );
  });

  it("inclui etapas numéricas no evento existente sem aceitar conteúdo extra do IPC", async () => {
    h.platform.onlineVideo = fakeApi({
      stream: vi.fn(async () => ({
        ...streams,
        timings: {
          resolve_ms: 125.4,
          session_open_ms: 75,
          join_wait_ms: 0,
          total_ms: 200,
          url: "https://secret",
          title: "private",
        },
      })),
    });
    const result = await stream(ID);
    expect(result.ok && result.timings).toEqual({
      resolve_ms: 125,
      session_open_ms: 75,
      join_wait_ms: 0,
      total_ms: 200,
    });
    expect(h.track).toHaveBeenCalledWith(
      "online_video_stream_resolved",
      expect.objectContaining({
        main_resolve_ms: 125,
        main_session_open_ms: 75,
        main_join_wait_ms: 0,
        main_total_ms: 200,
      })
    );
    expect(JSON.stringify(h.track.mock.calls)).not.toMatch(/secret|private/);
    expect(
      h.track.mock.calls.filter(([event]) => event === "online_video_stream_resolved")
    ).toHaveLength(1);
  });

  it("descarta durações inválidas e limita valores recebidos do main", async () => {
    h.platform.onlineVideo = fakeApi({
      stream: vi.fn(async () => ({
        ...streams,
        timings: {
          resolve_ms: -1,
          session_open_ms: Infinity,
          join_wait_ms: "100",
          total_ms: 999_999_999,
        },
      })),
    });
    await stream(ID);
    const properties = h.track.mock.calls.find(
      ([event]) => event === "online_video_stream_resolved"
    )?.[1];
    expect(properties).toMatchObject({ main_total_ms: 600_000 });
    expect(properties).not.toHaveProperty("main_resolve_ms");
    expect(properties).not.toHaveProperty("main_session_open_ms");
    expect(properties).not.toHaveProperty("main_join_wait_ms");
  });

  it("no navegador (sem bridge) responde 'unsupported', sem lançar", async () => {
    h.platform.onlineVideo = null;
    expect(await stream(ID)).toMatchObject({ ok: false, error: { kind: "unsupported" } });
  });

  it("main antigo, sem o handler: também 'unsupported'", async () => {
    h.platform.onlineVideo = fakeApi(); // sem `stream`
    expect(await stream(ID)).toMatchObject({ ok: false, error: { kind: "unsupported" } });
  });

  it("falha do main chega como resultado e é medida; cancelar não conta como falha", async () => {
    h.platform.onlineVideo = fakeApi({
      stream: vi.fn(async () => ({ ok: false, error: { kind: "network", message: "x" } })),
    });
    expect(await stream(ID)).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(h.track).toHaveBeenCalledWith(
      "online_video_stream_failed",
      expect.objectContaining({ kind: "network" })
    );

    h.track.mockClear();
    h.platform.onlineVideo = fakeApi({
      stream: vi.fn(async () => ({ ok: false, error: { kind: "cancelled", message: "x" } })),
    });
    await stream(ID);
    expect(h.track).not.toHaveBeenCalled();
  });

  it("o IPC em si falhar (janela recarregando) vira erro tratável, não exceção", async () => {
    h.platform.onlineVideo = fakeApi({
      stream: vi.fn(async () => {
        throw new Error("Error invoking remote method");
      }),
    });
    expect(await stream(ID)).toMatchObject({ ok: false, error: { kind: "unknown" } });
  });
});
