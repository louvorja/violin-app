/**
 * Abrir um vídeo do YouTube: toca já, das trilhas que o main baixa uma vez só (sem esperar o
 * download nem passar pelo player do YouTube), e o que acontece quando o operador cancela,
 * troca de vídeo ou toca outra coisa no meio. Vídeo só com formatos em fragmentos é baixado
 * pelo yt-dlp, e aí o operador acompanha esse download.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Broadcast from "@/helpers/Broadcast";
import { listenForVideoStateRequests } from "@/helpers/VideoStateRequest";
import { KEYS } from "@/constants/UserDataKeys";

const h = vi.hoisted(() => ({
  ensure: vi.fn(),
  stream: vi.fn(),
  cancel: vi.fn(),
  /** `readyState` e `error` do elemento de mídia principal (o jsdom não decodifica nada). */
  ready: 4,
  mediaError: null as unknown,
  downloaded: false,
  isDownloaded: vi.fn(async () => false),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  openWindows: vi.fn(async () => {}),
  openFileWindows: vi.fn(async () => {}),
  openMusicWindows: vi.fn(async () => {}),
  closeFileWindows: vi.fn(async () => {}),
  closeMusicWindows: vi.fn(async () => {}),
  closeWindows: vi.fn(async () => {}),
  send: vi.fn(),
  listeners: new Set<(_msg: { type: string; payload?: unknown }) => void>(),
}));

vi.mock("@/helpers/OnlineVideo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/OnlineVideo")>()),
  ensure: h.ensure,
  stream: h.stream,
  cancel: h.cancel,
  downloadEnabled: () => true,
  downloadAvailable: () => true,
  isDownloaded: h.isDownloaded,
  listFiles: async () => [],
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { info: h.info, warning: h.warning, error: h.error, show: vi.fn(), success: vi.fn() },
}));
vi.mock("@/helpers/ProjectionWindows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/ProjectionWindows")>()),
  openVideoProjectionWindows: h.openWindows,
  openFileProjectionWindows: h.openFileWindows,
  openProjectionWindows: h.openMusicWindows,
  closeFileProjectionWindows: h.closeFileWindows,
  closeMusicProjectionWindows: h.closeMusicWindows,
  closeProjectionWindows: h.closeWindows,
}));
vi.mock("@/helpers/Broadcast", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/helpers/Broadcast")>();
  return {
    ...original,
    default: {
      ...original.default,
      send: h.send,
      listen: vi.fn((callback: (_msg: { type: string; payload?: unknown }) => void) => {
        h.listeners.add(callback);
        return () => h.listeners.delete(callback);
      }),
    },
  };
});

type Media = typeof import("@/composables/useMedia").default;
let media: Media;
let openAudio: ReturnType<typeof vi.spyOn>;
let mediaSpies: { mockRestore(): void }[] = [];

const ID = "T8YHfGrk3ok";
const OTHER = "jNQXAC9IVRw";
const embed = (id: string) => `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&controls=0`;
const ok = (id: string) => ({ ok: true, id, url: `louvorja://onlinevideo/${id}.mp4`, size: 1, cached: false });
const cancelled = { ok: false, error: { kind: "cancelled", message: "Download cancelado" } };
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const streams = (id: string) => ({
  ok: true as const,
  id,
  video: { url: `louvorja://onlinestream/${id}/video`, height: 1080 },
  audio: { url: `louvorja://onlinestream/${id}/audio` },
  muxed: false,
  duration: 235,
});
const streamFail = (kind: string) => ({ ok: false as const, error: { kind, message: kind } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Cada chamada de ensure vira um download que o teste resolve quando quiser. */
function controlledDownloads() {
  const calls: { id: string; done: ReturnType<typeof deferred<unknown>> }[] = [];
  h.ensure.mockImplementation((id: string) => {
    const done = deferred<unknown>();
    calls.push({ id, done });
    return done.promise;
  });
  return calls;
}

// O preparo em curso é estado de módulo: cada teste começa com um módulo novo.
beforeEach(async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  media = (await import("@/composables/useMedia")).default;
  h.ensure.mockReset();
  h.stream.mockReset();
  h.cancel.mockReset();
  h.ready = 4;
  h.mediaError = null;
  h.downloaded = false;
  h.isDownloaded.mockReset().mockImplementation(async () => h.downloaded);
  h.info.mockClear();
  h.warning.mockClear();
  h.error.mockClear();
  h.openWindows.mockClear();
  h.openFileWindows.mockClear();
  h.openMusicWindows.mockClear();
  h.closeFileWindows.mockClear();
  h.closeMusicWindows.mockClear();
  h.closeWindows.mockClear();
  h.send.mockClear();
  h.listeners.clear();
  openAudio = vi.spyOn(media, "openAudio").mockResolvedValue(undefined);
  mediaSpies = [
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockImplementation(() => h.ready),
  ];
  // O jsdom nem declara `error`; o elemento real o tem.
  Object.defineProperty(HTMLMediaElement.prototype, "error", {
    configurable: true,
    get: () => h.mediaError,
  });
});

afterEach(() => {
  openAudio.mockRestore();
  mediaSpies.forEach((spy) => spy.mockRestore());
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).error;
  vi.useRealTimers();
});

/** O yt-dlp baixa o vídeo (só há formatos em fragmentos): não há trilha para tocar antes do fim. */
function onlyFragmentedFormats() {
  h.stream.mockResolvedValue(streamFail("busy"));
}

describe("acompanhar o download do yt-dlp e projetar", () => {
  beforeEach(onlyFragmentedFormats);

  it("com o vídeo pronto, abre as janelas e toca o arquivo (não o player do YouTube)", async () => {
    h.ensure.mockResolvedValue(ok(ID));
    expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
    expect(h.openWindows).toHaveBeenCalledWith({ withOperator: true });
    expect(openAudio).toHaveBeenCalledWith({
      url: `louvorja://onlinevideo/${ID}.mp4`,
      title: "Louvor",
      mediaType: "video",
    }, true);
  });

  it("cancelado pelo operador: não abre nada, e nenhum aviso de erro", async () => {
    h.ensure.mockResolvedValue(cancelled);
    expect(await media.openYouTube(embed(ID), "Louvor")).toBe(false);
    expect(openAudio).not.toHaveBeenCalled();
    expect(h.warning).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });

  it("lookup de cache atrasado não inicia vídeo depois que o editor assumiu", async () => {
    const lookup = deferred<boolean>();
    h.isDownloaded.mockReturnValueOnce(lookup.promise);
    const video = media.openYouTube(embed(ID), "Vídeo antigo");
    await tick();
    expect(h.isDownloaded).toHaveBeenCalledWith(ID);
    expect(h.ensure).not.toHaveBeenCalled();
    await media.stopForSlideEditor();
    expect(media.opening()).toBeNull();

    lookup.resolve(true);
    expect(await video).toBe(false);
    expect(h.ensure).not.toHaveBeenCalled();
    expect(h.stream).not.toHaveBeenCalled();
    expect(h.openWindows).not.toHaveBeenCalled();
  });
});

it("um close de palco já enviado termina antes de uma nova projeção FILE", async () => {
  const closing = deferred<void>();
  h.closeWindows.mockImplementationOnce(() => closing.promise);

  media.close(true);
  await vi.waitFor(() => expect(h.closeWindows).toHaveBeenCalledOnce());

  const nextStage = media.projectFile({ url: "blob:new-reading", type: "image", title: "Leitura" });
  await tick();
  expect(h.openFileWindows).not.toHaveBeenCalled();

  closing.resolve();
  await expect(nextStage).resolves.toBe(true);
  expect(h.openFileWindows).toHaveBeenCalledOnce();
});

describe("cancelar e tocar de novo (download do yt-dlp)", () => {
  beforeEach(onlyFragmentedFormats);

  it("cancelar pelo botão de parar e pedir o mesmo vídeo na hora começa um download novo", async () => {
    const calls = controlledDownloads();
    const first = media.openYouTube(embed(ID), "Louvor");
    await tick();
    media.close(true); // o operador parou
    expect(h.cancel).toHaveBeenCalledWith(ID);

    const second = media.openYouTube(embed(ID), "Louvor"); // e clicou de novo, sem esperar
    await tick();
    expect(calls).toHaveLength(2); // pedido novo, não a carona no que foi cancelado

    calls[0].done.resolve(cancelled);
    calls[1].done.resolve(ok(ID));
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(openAudio).toHaveBeenCalledTimes(1);
  });

  it("o resultado do download cancelado, chegando depois, não abre o vídeo por cima do novo", async () => {
    const calls = controlledDownloads();
    const first = media.openYouTube(embed(ID), "Louvor");
    await tick();
    media.close(true);
    const second = media.openYouTube(embed(ID), "Louvor");
    await tick();

    // O antigo termina "com sucesso" (o cancelamento chegou tarde): já não interessa.
    calls[0].done.resolve(ok(ID));
    await first;
    expect(openAudio).not.toHaveBeenCalled();
    calls[1].done.resolve(ok(ID));
    await second;
    expect(openAudio).toHaveBeenCalledTimes(1);
  });

  it("pedir o mesmo vídeo duas vezes seguidas, sem cancelar, continua sendo uma projeção só", async () => {
    const calls = controlledDownloads();
    const first = media.openYouTube(embed(ID), "Louvor");
    const second = media.openYouTube(embed(ID), "Louvor");
    await tick();
    expect(calls).toHaveLength(1);
    calls[0].done.resolve(ok(ID));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(openAudio).toHaveBeenCalledTimes(1);
  });

  it("pedir outro vídeo cancela o anterior e só o novo abre", async () => {
    const calls = controlledDownloads();
    const first = media.openYouTube(embed(ID), "Um");
    await tick();
    const second = media.openYouTube(embed(OTHER), "Dois");
    await tick();
    expect(h.cancel).toHaveBeenCalledWith(ID);

    calls[0].done.resolve(cancelled);
    calls[1].done.resolve(ok(OTHER));
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(openAudio).toHaveBeenCalledTimes(1);
    expect(openAudio.mock.calls[0][0]).toMatchObject({ title: "Dois" });
  });

  it("tocar outra mídia no meio do download cancela o vídeo pendente", async () => {
    const calls = controlledDownloads();
    const pending = media.openYouTube(embed(ID), "Louvor");
    await tick();
    openAudio.mockRestore(); // aqui o openAudio é o de verdade: ele é quem cancela
    const real = vi.spyOn(media, "openAudio");
    await media.openAudio({ url: "blob:x", title: "Hino", mediaType: "audio" }).catch(() => {});
    expect(h.cancel).toHaveBeenCalledWith(ID);
    calls[0].done.resolve(cancelled);
    expect(await pending).toBe(false);
    real.mockRestore();
  });
});

describe("tocar já: das trilhas que o main baixa, sem esperar o download e sem o player do YouTube", () => {
  let embedded: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    embedded = vi.spyOn(media, "openEmbeddedYouTube").mockResolvedValue(undefined);
    h.stream.mockResolvedValue(streams(ID));
  });
  afterEach(() => embedded.mockRestore());

  it("toca do arquivo em crescimento: imagem nas janelas, som na principal, e nenhum player do YouTube", async () => {
    controlledDownloads();
    const { video, audio } = streams(ID);
    expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
    expect(h.stream).toHaveBeenCalledWith(ID);
    expect(h.openWindows).toHaveBeenCalledWith({ withOperator: true });
    expect(h.send).toHaveBeenCalledWith(BROADCAST_TYPE.FILE_PROJECTION, {
      url: video.url,
      type: "video",
      title: "Louvor",
      stage_epoch: expect.any(Number),
    });
    // a imagem do player do app vem da trilha de vídeo; o som, da de áudio
    expect(openAudio).toHaveBeenCalledWith({
      url: audio.url,
      title: "Louvor",
      mediaType: "video",
      videoUrl: video.url,
    }, true);
    expect(embedded).not.toHaveBeenCalled();
    // abre direto: nenhum toast de "abrindo" entre o clique e o vídeo
    expect(h.info).not.toHaveBeenCalled();
  });

  it("emite um resumo de latência por abertura, sem título ou URL", async () => {
    const { default: Telemetry } = await import("@/helpers/Telemetry");
    const track = vi.spyOn(Telemetry, "track").mockImplementation(() => {});
    controlledDownloads();

    expect(await media.openYouTube(embed(ID), "Título privado")).toBe(true);

    const summary = track.mock.calls.find(([event]) => event === "online_video_stream_start_latency")?.[1];
    expect(summary).toMatchObject({ outcome: "playing" });
    expect(summary?.resolution_ms).toEqual(expect.any(Number));
    expect(summary?.projection_open_ms).toEqual(expect.any(Number));
    expect(summary?.media_ready_ms).toEqual(expect.any(Number));
    expect(summary).not.toHaveProperty("title");
    expect(summary).not.toHaveProperty("url");
    expect(summary).not.toHaveProperty("video_id");
    expect(track.mock.calls.filter(([event]) => event === "online_video_stream_start_latency")).toHaveLength(1);
    track.mockRestore();
  });

  it("o vídeo que já estava no disco quando o main foi perguntado toca do arquivo, sem trilhas separadas", async () => {
    const file = `louvorja://onlinevideo/${ID}.mp4`;
    h.stream.mockResolvedValue({ ok: true, id: ID, cached: true, video: { url: file }, audio: { url: file }, muxed: true, duration: null });
    controlledDownloads();
    expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
    expect(openAudio).toHaveBeenCalledWith({ url: file, title: "Louvor", mediaType: "video" }, true);
    expect(embedded).not.toHaveBeenCalled();
  });

  it("já baixando pelo yt-dlp (vídeo só com formatos em fragmentos): acompanha esse download, sem abrir o player do YouTube", async () => {
    h.stream.mockResolvedValue(streamFail("busy"));
    const calls = controlledDownloads();
    const opening = media.openYouTube(embed(ID), "Louvor");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0].done.resolve(ok(ID));
    expect(await opening).toBe(true);
    expect(embedded).not.toHaveBeenCalled();
    expect(h.warning).not.toHaveBeenCalled();
    expect(openAudio).toHaveBeenCalledWith({
      url: `louvorja://onlinevideo/${ID}.mp4`,
      title: "Louvor",
      mediaType: "video",
    }, true);
  });

  it("o download só começa depois de o vídeo estar tocando, e sem guardá-lo", async () => {
    h.ready = 0; // o som ainda não está pronto
    const calls = controlledDownloads();
    const opening = media.openYouTube(embed(ID), "Louvor");
    await sleep(450);
    expect(openAudio).toHaveBeenCalledTimes(1);
    expect(h.ensure).not.toHaveBeenCalled();

    h.ready = 4;
    expect(await opening).toBe(true);
    expect(calls).toHaveLength(1);
    expect(h.ensure).toHaveBeenCalledWith(ID, expect.any(Function), { background: true, keep: false });
  });

  it("terminar de baixar não troca o que já está tocando", async () => {
    const calls = controlledDownloads();
    await media.openYouTube(embed(ID), "Louvor");
    calls[0].done.resolve(ok(ID));
    await tick();
    expect(openAudio).toHaveBeenCalledTimes(1);
    expect(h.openWindows).toHaveBeenCalledTimes(1);
    expect(embedded).not.toHaveBeenCalled();
  });

  it("se o download em segundo plano falha, ninguém é avisado: o vídeo já está tocando", async () => {
    const calls = controlledDownloads();
    await media.openYouTube(embed(ID), "Louvor");
    calls[0].done.resolve({ ok: false, error: { kind: "network", message: "sem rede" } });
    await tick();
    expect(h.warning).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });

  it("com o arquivo já no disco, toca dele e nem procura os links", async () => {
    h.downloaded = true;
    h.ensure.mockResolvedValue({ ...ok(ID), cached: true });
    expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
    expect(h.stream).not.toHaveBeenCalled();
    expect(embedded).not.toHaveBeenCalled();
    expect(openAudio).toHaveBeenCalledWith(expect.objectContaining({ url: `louvorja://onlinevideo/${ID}.mp4` }), true);
  });

  it("pedir o mesmo vídeo de novo enquanto abre continua sendo uma projeção só", async () => {
    controlledDownloads();
    const first = media.openYouTube(embed(ID), "Louvor");
    const second = media.openYouTube(embed(ID), "Louvor");
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(h.stream).toHaveBeenCalledTimes(1);
    expect(openAudio).toHaveBeenCalledTimes(1);
  });

  describe("quando os links diretos não servem", () => {
    it("rede ou YouTube fora do ar: cai no player do YouTube, avisa, baixa ao fundo e registra o motivo no console", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      h.stream.mockResolvedValue(streamFail("network"));
      const calls = controlledDownloads();
      expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
      expect(warn).toHaveBeenCalledWith("[OnlineVideo] abrir direto falhou:", {
        id: ID,
        kind: "network",
        message: "network",
      });
      warn.mockRestore();
      expect(embedded).toHaveBeenCalledWith(embed(ID), "Louvor", expect.any(Number));
      expect(h.warning).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(1);
      expect(h.ensure).toHaveBeenCalledWith(ID, expect.any(Function), { background: true, keep: false });
      expect(openAudio).not.toHaveBeenCalled();
    });

    it("ferramentas ainda não instaladas (primeiro uso): player do YouTube sem aviso, e o download as instala", async () => {
      h.stream.mockResolvedValue(streamFail("tools"));
      const calls = controlledDownloads();
      expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
      expect(embedded).toHaveBeenCalledTimes(1);
      expect(h.warning).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
    });

    it("o vídeo em si não pode ser projetado (privado): avisa o operador e não abre nada", async () => {
      h.stream.mockResolvedValue(streamFail("private"));
      controlledDownloads();
      expect(await media.openYouTube(embed(ID), "Louvor")).toBe(false);
      expect(h.error).toHaveBeenCalledTimes(1);
      expect(embedded).not.toHaveBeenCalled();
      expect(openAudio).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
    });

    it("cancelado enquanto procura os links: não abre nada, sem aviso", async () => {
      h.stream.mockResolvedValue(streamFail("cancelled"));
      expect(await media.openYouTube(embed(ID), "Louvor")).toBe(false);
      expect(embedded).not.toHaveBeenCalled();
      expect(h.warning).not.toHaveBeenCalled();
      expect(h.error).not.toHaveBeenCalled();
    });

    it("o som não fica pronto no prazo: fecha o que abriu, cai no player do YouTube e baixa ao fundo", async () => {
      vi.useFakeTimers();
      h.ready = 0;
      const closed = vi.spyOn(media, "close").mockImplementation(() => {});
      controlledDownloads();
      const opening = media.openYouTube(embed(ID), "Louvor");
      await vi.advanceTimersByTimeAsync(21_000);
      expect(await opening).toBe(true);
      expect(closed).toHaveBeenCalledWith(true, true, true, true);
      expect(embedded).toHaveBeenCalledWith(embed(ID), "Louvor", expect.any(Number));
      expect(h.warning).toHaveBeenCalledTimes(1);
      expect(h.ensure).toHaveBeenCalledTimes(1);
      closed.mockRestore();
    });

    it("o elemento de som acusa erro: cai no player do YouTube sem esperar o prazo e registra o código do erro", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      h.ready = 0;
      h.mediaError = { code: 4 };
      const closed = vi.spyOn(media, "close").mockImplementation(() => {});
      controlledDownloads();
      expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        "[OnlineVideo] o vídeo aberto direto não chegou a tocar:",
        expect.objectContaining({ id: ID, ready_state: 0, error_code: 4 })
      );
      warn.mockRestore();
      expect(embedded).toHaveBeenCalledTimes(1);
      expect(h.ensure).toHaveBeenCalledTimes(1);
      closed.mockRestore();
    });
  });

  describe("o vídeo já baixa por pedido do operador (botão de baixar, link novo)", () => {
    const startCardDownload = async () => {
      const { useOnlineVideoDownloads } = await import("@/composables/useOnlineVideoDownloads");
      const downloads = useOnlineVideoDownloads();
      downloads.mark(ID); // o cartão mostra o andamento
      return downloads;
    };

    it("tocar entra nesse download: um pedido só de links, e o cartão segue mostrando o andamento", async () => {
      const downloads = await startCardDownload();
      expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
      expect(h.stream).toHaveBeenCalledTimes(1);
      expect(openAudio).toHaveBeenCalledTimes(1);
      expect(h.ensure).not.toHaveBeenCalled(); // não abre um segundo download por cima
      expect(downloads.stateOf(ID)).toBe("downloading");
    });

    it("fechar a mídia enquanto entra nele só deixa de esperar: o download do operador não é cancelado", async () => {
      await startCardDownload();
      const links = deferred<unknown>();
      h.stream.mockReturnValue(links.promise);
      const pending = media.openYouTube(embed(ID), "Louvor");
      await tick();
      media.close(true);
      expect(h.cancel).not.toHaveBeenCalled();

      links.resolve(streams(ID));
      expect(await pending).toBe(false);
      expect(openAudio).not.toHaveBeenCalled();
    });

    it("editor assume o palco sem cancelar o download iniciado pelo operador", async () => {
      await startCardDownload();
      const links = deferred<unknown>();
      h.stream.mockReturnValue(links.promise);
      const pending = media.openYouTube(embed(ID), "Louvor");
      await tick();

      await media.stopForSlideEditor();
      expect(h.cancel).not.toHaveBeenCalled();

      links.resolve(streams(ID));
      expect(await pending).toBe(false);
      expect(h.openWindows).not.toHaveBeenCalled();
    });

    it("pedir outro vídeo nesse meio-tempo também não cancela o download do primeiro", async () => {
      await startCardDownload();
      controlledDownloads(); // o vídeo novo baixa ao fundo depois de começar a tocar
      const links = deferred<unknown>();
      h.stream.mockImplementation((id: string) => (id === ID ? links.promise : Promise.resolve(streams(id))));
      const one = media.openYouTube(embed(ID), "Um");
      await tick();
      const two = media.openYouTube(embed(OTHER), "Dois");
      expect(await two).toBe(true);
      expect(h.cancel).not.toHaveBeenCalled();

      links.resolve(streams(ID));
      expect(await one).toBe(false);
    });
  });

  describe("o operador muda de ideia no meio", () => {
    it("fecha a mídia enquanto os links chegam: o resultado tardio não abre nada", async () => {
      const links = deferred<unknown>();
      h.stream.mockReturnValue(links.promise);
      controlledDownloads();
      const pending = media.openYouTube(embed(ID), "Louvor");
      await tick();
      media.close(true);
      expect(h.cancel).toHaveBeenCalledWith(ID);

      links.resolve(streams(ID));
      expect(await pending).toBe(false);
      expect(openAudio).not.toHaveBeenCalled();
      expect(embedded).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
    });

    it("fecha a mídia depois de as janelas abrirem e antes de o som ficar pronto: nada de player por cima", async () => {
      h.ready = 0;
      controlledDownloads();
      const pending = media.openYouTube(embed(ID), "Louvor");
      await vi.waitFor(() => expect(openAudio).toHaveBeenCalledTimes(1));
      media.close(true);
      expect(await pending).toBe(false);
      expect(embedded).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
    });

    it("pede outro vídeo enquanto as janelas do primeiro ainda abrem: o primeiro não abre o som por cima", async () => {
      const windowsOpening = deferred<void>();
      h.openWindows.mockImplementationOnce(() => windowsOpening.promise);
      controlledDownloads();
      const one = media.openYouTube(embed(ID), "Um");
      await vi.waitFor(() => expect(h.openWindows).toHaveBeenCalledTimes(1));
      const two = media.openYouTube(embed(OTHER), "Dois");
      expect(await two).toBe(true);

      windowsOpening.resolve();
      expect(await one).toBe(false);
      expect(openAudio).toHaveBeenCalledTimes(1);
      expect(openAudio.mock.calls[0][0]).toMatchObject({ title: "Dois" });
    });

    it("pede outro vídeo enquanto os links do primeiro chegam: só o novo abre", async () => {
      const first = deferred<unknown>();
      h.stream.mockImplementation((id: string) => (id === ID ? first.promise : Promise.resolve(streams(id))));
      controlledDownloads();
      const one = media.openYouTube(embed(ID), "Um");
      await tick();
      const two = media.openYouTube(embed(OTHER), "Dois");
      expect(await two).toBe(true);

      first.resolve(streams(ID));
      expect(await one).toBe(false);
      expect(openAudio).toHaveBeenCalledTimes(1);
      expect(openAudio.mock.calls[0][0]).toMatchObject({ title: "Dois" });
    });
  });
});

describe("aviso de que o vídeo está sendo aberto (o clique não pode parecer morto)", () => {
  let embedded: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    embedded = vi.spyOn(media, "openEmbeddedYouTube").mockResolvedValue(undefined);
    controlledDownloads();
  });
  afterEach(() => embedded.mockRestore());

  it("existe desde o clique, enquanto o yt-dlp ainda resolve os links, e some quando o vídeo toca", async () => {
    expect(media.opening()).toBeNull();
    const links = deferred<ReturnType<typeof streams>>();
    h.stream.mockReturnValue(links.promise);

    const opening = media.openYouTube(embed(ID), "Hino 202");
    expect(media.opening()).toEqual({ id: ID, title: "Hino 202" });
    await sleep(20);
    expect(media.opening()).toEqual({ id: ID, title: "Hino 202" });

    links.resolve(streams(ID));
    expect(await opening).toBe(true);
    expect(media.opening()).toBeNull();
  });

  it("um vídeo já baixado também mostra o aviso até tocar", async () => {
    h.downloaded = true;
    const calls = controlledDownloads();
    const opening = media.openYouTube(embed(ID), "Hino 202");
    expect(media.opening()).toEqual({ id: ID, title: "Hino 202" });
    await sleep(20);
    calls[0].done.resolve(ok(ID));
    expect(await opening).toBe(true);
    expect(media.opening()).toBeNull();
  });

  it("some quando o vídeo não pode ser aberto (indisponível, com o aviso de erro)", async () => {
    h.stream.mockResolvedValue(streamFail("unavailable"));
    expect(await media.openYouTube(embed(ID), "Hino 202")).toBe(false);
    expect(media.opening()).toBeNull();
  });

  it("some quando cai no player do YouTube", async () => {
    h.stream.mockResolvedValue(streamFail("network"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await media.openYouTube(embed(ID), "Hino 202")).toBe(true);
    expect(embedded).toHaveBeenCalledOnce();
    expect(media.opening()).toBeNull();
  });

  it("some também quando algo dá errado no meio do caminho", async () => {
    h.stream.mockRejectedValue(new Error("falha inesperada"));
    await expect(media.openYouTube(embed(ID), "Hino 202")).rejects.toThrow("falha inesperada");
    expect(media.opening()).toBeNull();
  });

  it("cancelar pelo aviso desiste do pedido: o aviso some e o vídeo não abre depois", async () => {
    const links = deferred<ReturnType<typeof streams>>();
    h.stream.mockReturnValue(links.promise);
    const opening = media.openYouTube(embed(ID), "Hino 202");
    await sleep(20);

    media.cancelOpening();
    expect(media.opening()).toBeNull();
    expect(h.cancel).toHaveBeenCalledWith(ID);

    links.resolve(streams(ID));
    expect(await opening).toBe(false);
    expect(openAudio).not.toHaveBeenCalled();
  });

  it("pedir outro vídeo troca o aviso, e o pedido antigo, ao terminar, não apaga o do novo", async () => {
    const first = deferred<ReturnType<typeof streams>>();
    const second = deferred<ReturnType<typeof streams>>();
    h.stream.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const a = media.openYouTube(embed(ID), "Primeiro");
    await sleep(20);
    const b = media.openYouTube(embed(OTHER), "Segundo");
    expect(media.opening()).toEqual({ id: OTHER, title: "Segundo" });

    first.resolve(streams(ID));
    expect(await a).toBe(false);
    expect(media.opening()).toEqual({ id: OTHER, title: "Segundo" });

    second.resolve(streams(OTHER));
    expect(await b).toBe(true);
    expect(media.opening()).toBeNull();
  });
});

describe("com o download automático desligado", () => {
  it("um vídeo já baixado toca do arquivo mesmo assim", async () => {
    vi.resetModules();
    vi.doMock("@/helpers/OnlineVideo", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/helpers/OnlineVideo")>()),
      ensure: h.ensure,
      cancel: h.cancel,
      downloadEnabled: () => false,
      isDownloaded: async () => true,
    }));
    setActivePinia(createPinia());
    const fresh = (await import("@/composables/useMedia")).default;
    const spy = vi.spyOn(fresh, "openAudio").mockResolvedValue(undefined);
    h.ensure.mockResolvedValue({ ...ok(ID), cached: true });

    expect(await fresh.openYouTube(embed(ID), "Louvor")).toBe(true);
    expect(h.ensure).toHaveBeenCalledWith(ID, expect.anything());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ url: `louvorja://onlinevideo/${ID}.mp4` }), true);
    vi.doUnmock("@/helpers/OnlineVideo");
  });

  it("um vídeo que não está no disco abre pelo player do YouTube, sem procurar links nem baixar", async () => {
    vi.resetModules();
    vi.doMock("@/helpers/OnlineVideo", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/helpers/OnlineVideo")>()),
      ensure: h.ensure,
      stream: h.stream,
      cancel: h.cancel,
      downloadEnabled: () => false,
      isDownloaded: async () => false,
    }));
    setActivePinia(createPinia());
    const fresh = (await import("@/composables/useMedia")).default;
    const embedded = vi.spyOn(fresh, "openEmbeddedYouTube").mockResolvedValue(undefined);

    expect(await fresh.openYouTube(embed(ID), "Louvor")).toBe(true);
    expect(embedded).toHaveBeenCalledWith(embed(ID), "Louvor", expect.any(Number));
    expect(h.stream).not.toHaveBeenCalled();
    expect(h.ensure).not.toHaveBeenCalled();
    vi.doUnmock("@/helpers/OnlineVideo");
  });
});

describe("trocar do vídeo baixado para o player embutido", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("apaga o payload de projeção por arquivo ao cair no embed, senão uma janela recriada depois mostra o vídeo antigo", async () => {
    // O localStorage do ambiente de teste é um objeto pelado, sem os métodos.
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => guardado.get(k) ?? null,
      setItem: (k: string, v: string) => void guardado.set(k, v),
      removeItem: (k: string) => void guardado.delete(k),
    });

    // Um vídeo baixado (yt-dlp) tocou antes: `_openVideoFileProjection` grava este payload
    // para janelas que abrirem depois de perder o broadcast ao vivo (ver `_readPendingProjection`).
    localStorage.setItem(
      KEYS.PROJECTION.LJ_FILE_PROJECTION,
      JSON.stringify({ url: "louvorja://onlinevideo/old.mp4", type: "video", title: "Vídeo antigo" })
    );

    await media.openEmbeddedYouTube(embed(OTHER), "Vídeo novo");

    // `_readPendingProjection` sempre olha LJ_FILE_PROJECTION primeiro: sobrevivendo, uma
    // janela de retorno ou operador recriada depois voltaria a mostrar o vídeo baixado antigo
    // em vez do player embutido atual — exatamente o "cada janela por si" relatado.
    expect(localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION)).toBeNull();
    expect(localStorage.getItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION)).toContain(OTHER);
  });
});

describe("trocar de um vídeo embutido para outro", () => {
  it("não fecha a janela de projeção para reabri-la: o clique no segundo vídeo trava e apaga a tela, porque o Electron ainda está destruindo a janela quando o pedido de reabrir a mesma feature chega", async () => {
    await media.openEmbeddedYouTube(embed(ID), "Vídeo 1");
    await media.openEmbeddedYouTube(embed(OTHER), "Vídeo 2");

    expect(h.closeWindows).not.toHaveBeenCalled();
    expect(h.openWindows).toHaveBeenCalledTimes(2);
  });
});

describe("posse do palco durante a abertura do vídeo", () => {
  afterEach(() => vi.unstubAllGlobals());

  const storage = () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
  };

  it.each(["editor", "música"] as const)(
    "FILE antigo não publica nem inicia vídeo quando %s assume durante sua abertura",
    async (next) => {
      storage();
      const fileOpened = deferred<void>();
      h.openFileWindows.mockReturnValueOnce(fileOpened.promise);
      const oldFile = media.projectFile(
        { url: "blob:old-video", type: "video", title: "Vídeo antigo" },
        "blob:old-video"
      );
      await tick();
      const newOwner = next === "editor"
        ? media.stopForSlideEditor()
        : media.openCustomSong({ nome: "Música nova", slides: [{ tipo: "CAPA", letra: "Capa" }] });
      fileOpened.resolve();
      const [projected] = await Promise.all([oldFile, newOwner]);

      expect(projected).toBe(false);
      expect(h.send).not.toHaveBeenCalledWith(BROADCAST_TYPE.FILE_PROJECTION, expect.anything());
      expect(openAudio).not.toHaveBeenCalled();
      expect(h.closeFileWindows).toHaveBeenCalledOnce();
      expect(localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION)).toBeNull();
    }
  );

  it("PDF válido mantém cache de reabertura e projeta sem abrir player de áudio", async () => {
    storage();
    const payload = { url: "blob:pdf", type: "pdf" as const, title: "Leitura", page: 1 };
    expect(await media.projectFile(payload)).toBe(true);
    expect(h.openFileWindows).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenCalledWith(BROADCAST_TYPE.FILE_PROJECTION, {
      ...payload,
      playback_id: expect.any(String),
      stage_epoch: expect.any(Number),
    });
    expect(JSON.parse(localStorage.getItem(KEYS.PROJECTION.LJ_FILE_PROJECTION) || "null"))
      .toMatchObject({ ...payload, playback_id: expect.any(String) });
    expect(openAudio).not.toHaveBeenCalled();
  });

  it("imagem/PDF da liturgia preserva áudio em curso; a biblioteca pode pedir parada", async () => {
    storage();
    const { useAudioPlayback } = await import("@/composables/useAudioPlayback");
    const stop = vi.spyOn(useAudioPlayback(), "stop");
    try {
      await media.projectFile({ url: "blob:reading", type: "pdf", title: "Leitura" });
      expect(stop).not.toHaveBeenCalled();
      await media.projectFile(
        { url: "blob:library", type: "image", title: "Acervo" },
        undefined,
        { stopExistingAudio: true }
      );
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      stop.mockRestore();
    }
  });

  it("fechar enquanto FILE abre remove a janela tardia e não publica o arquivo", async () => {
    storage();
    const fileOpened = deferred<void>();
    h.openFileWindows.mockReturnValueOnce(fileOpened.promise);
    const oldFile = media.projectFile({ url: "blob:old-image", type: "image", title: "Antiga" });
    await tick();
    media.close(true);
    fileOpened.resolve();
    expect(await oldFile).toBe(false);
    await vi.waitFor(() => expect(h.closeFileWindows).toHaveBeenCalledOnce());
    expect(h.send).not.toHaveBeenCalledWith(BROADCAST_TYPE.FILE_PROJECTION, expect.anything());
  });

  it("editor espera a abertura antiga terminar e fecha FILE antes de projetar slides", async () => {
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => guardado.get(key) ?? null,
      setItem: (key: string, value: string) => void guardado.set(key, value),
      removeItem: (key: string) => void guardado.delete(key),
    });
    const windowOpened = deferred<void>();
    h.openWindows.mockReturnValueOnce(windowOpened.promise);
    const youtube = media.openEmbeddedYouTube(embed(ID), "Vídeo antigo");
    await tick();

    const editor = media.stopForSlideEditor();
    expect(h.closeFileWindows).not.toHaveBeenCalled();
    windowOpened.resolve();
    await Promise.all([youtube, editor]);

    expect(h.closeFileWindows).toHaveBeenCalledOnce();
    expect(localStorage.getItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION)).toBeNull();
    expect(h.send).not.toHaveBeenCalledWith(BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION, expect.anything());
    expect(h.listeners.size).toBe(0);
  });

  it("música só abre suas janelas depois que o vídeo pendente foi fechado", async () => {
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => guardado.get(key) ?? null,
      setItem: (key: string, value: string) => void guardado.set(key, value),
      removeItem: (key: string) => void guardado.delete(key),
    });
    const windowOpened = deferred<void>();
    h.openWindows.mockReturnValueOnce(windowOpened.promise);
    const oldVideo = media.openEmbeddedYouTube(embed(ID), "Vídeo antigo");
    await tick();

    const music = media.openCustomSong({ nome: "Música nova", slides: [{ tipo: "CAPA", letra: "Capa" }] });
    await tick();
    expect(h.openMusicWindows).not.toHaveBeenCalled();
    windowOpened.resolve();
    await Promise.all([oldVideo, music]);

    expect(h.closeFileWindows).toHaveBeenCalledOnce();
    expect(h.openMusicWindows).toHaveBeenCalledOnce();
    expect(h.send).not.toHaveBeenCalledWith(BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION, expect.anything());
    expect(localStorage.getItem(KEYS.PROJECTION.LJ_YOUTUBE_PROJECTION)).toBeNull();
  });

  it("vídeo embutido fecha MUSIC/RETURN antes de abrir FILE", async () => {
    await media.openEmbeddedYouTube(embed(ID), "Vídeo");
    expect(h.closeMusicWindows).toHaveBeenCalledOnce();
    expect(h.closeMusicWindows.mock.invocationCallOrder[0]).toBeLessThan(
      h.openWindows.mock.invocationCallOrder[0]
    );
  });

  it("vídeo baixado fecha MUSIC/RETURN antes de abrir FILE", async () => {
    h.downloaded = true;
    h.ensure.mockResolvedValue({ ...ok(ID), cached: true });
    await media.openYouTube(embed(ID), "Vídeo");
    expect(h.closeMusicWindows).toHaveBeenCalledOnce();
    expect(h.closeMusicWindows.mock.invocationCallOrder[0]).toBeLessThan(
      h.openWindows.mock.invocationCallOrder[0]
    );
  });

  it("close de MUSIC atrasado do vídeo antigo não fecha a janela da música nova", async () => {
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => guardado.get(key) ?? null,
      setItem: (key: string, value: string) => void guardado.set(key, value),
      removeItem: (key: string) => void guardado.delete(key),
    });
    const musicClose = deferred<void>();
    h.closeMusicWindows.mockReturnValueOnce(musicClose.promise);
    const oldVideo = media.openEmbeddedYouTube(embed(ID), "Vídeo antigo");
    await tick();
    const newMusic = media.openCustomSong({ nome: "Nova", slides: [{ tipo: "CAPA", letra: "Capa" }] });
    expect(h.openMusicWindows).not.toHaveBeenCalled();

    musicClose.resolve();
    await Promise.all([oldVideo, newMusic]);

    expect(h.openWindows).not.toHaveBeenCalled();
    expect(h.closeFileWindows).toHaveBeenCalledOnce();
    expect(h.openMusicWindows).toHaveBeenCalledOnce();
  });

  it("abertura nativa de vídeo travada não impede o editor, e o fechamento tardio remove FILE", async () => {
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => guardado.get(key) ?? null,
      setItem: (key: string, value: string) => void guardado.set(key, value),
      removeItem: (key: string) => void guardado.delete(key),
    });
    const windowOpened = deferred<void>();
    h.openWindows.mockReturnValueOnce(windowOpened.promise);
    const oldVideo = media.openEmbeddedYouTube(embed(ID), "Vídeo antigo");
    await tick();

    vi.useFakeTimers();
    const editor = media.stopForSlideEditor();
    await vi.advanceTimersByTimeAsync(2500);
    await editor;
    expect(h.closeFileWindows).toHaveBeenCalledOnce();

    windowOpened.resolve();
    await oldVideo;
    await vi.waitFor(() => expect(h.closeFileWindows).toHaveBeenCalledTimes(2));
  });
});

describe("fim natural do player embutido", () => {
  it("responde ao reopen do YouTube com posição pausada do playback correto", async () => {
    await media.openEmbeddedYouTube(embed(ID), "Vídeo 1");
    const projection = h.send.mock.calls.find(
      ([type]) => type === BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION
    )?.[1] as { playback_id?: string } | undefined;
    const playbackId = projection?.playback_id;
    expect(playbackId).toBeTruthy();
    for (const listener of [...h.listeners]) {
      listener({
        type: BROADCAST_TYPE.YOUTUBE_STATE,
        payload: { playback_id: playbackId, state: 2, currentTime: 42, duration: 120, isPaused: true, sampledAt: 100 },
      });
      listener({
        type: BROADCAST_TYPE.YOUTUBE_STATE,
        payload: { playback_id: playbackId, state: 1, currentTime: 5, duration: 120, isPaused: false, sampledAt: 90 },
      });
    }
    media.broadcastVideoStateForRequest("retired-playback");
    expect(h.send.mock.calls.filter(([type]) => type === BROADCAST_TYPE.VIDEO_STATE)).toHaveLength(0);
    media.broadcastVideoStateForRequest(playbackId);
    expect(h.send).toHaveBeenCalledWith(BROADCAST_TYPE.VIDEO_STATE,
      expect.objectContaining({ playback_id: playbackId, revision: 1,
        currentTime: 42, duration: 120, isPaused: true }));
  });

  it("a Shell encerra somente o playback YouTube ativo ao receber state 0", async () => {
    await media.openEmbeddedYouTube(embed(ID), "Vídeo 1");
    const projection = h.send.mock.calls.find(
      ([type]) => type === BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION
    )?.[1] as { playback_id?: string } | undefined;
    expect(projection?.playback_id).toBeTruthy();

    const close = vi.spyOn(media, "close");
    const emitState = (playback_id?: string) => {
      for (const listener of [...h.listeners]) {
        listener({
          type: BROADCAST_TYPE.YOUTUBE_STATE,
          payload: { state: 0, playback_id, currentTime: 10, duration: 10, isPaused: true, sampledAt: Date.now() },
        });
      }
    };

    emitState();
    emitState("playback-obsoleto");
    expect(close).not.toHaveBeenCalled();

    media.pause();
    media.goToTime(12);
    expect(h.send).toHaveBeenCalledWith(BROADCAST_TYPE.YOUTUBE_CONTROL,
      expect.objectContaining({ action: "pause", playback_id: projection?.playback_id }));
    expect(h.send).toHaveBeenCalledWith(BROADCAST_TYPE.YOUTUBE_CONTROL,
      expect.objectContaining({ action: "seekTo", value: 12, playback_id: projection?.playback_id }));

    emitState(projection?.playback_id as string);
    emitState(projection?.playback_id as string);
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(true);
    expect(h.send).toHaveBeenCalledWith(BROADCAST_TYPE.MEDIA_CLOSE);

    close.mockRestore();
  });
});

describe("sincronia versionada do vídeo local", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("republica a identidade da projeção e incrementa revision no mesmo playback", async () => {
    const url = "louvorja://onlinevideo/video-state.mp4";
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => guardado.get(key) ?? null,
      setItem: (key: string, value: string) => void guardado.set(key, value),
      removeItem: (key: string) => void guardado.delete(key),
    });
    localStorage.setItem(
      KEYS.PROJECTION.LJ_FILE_PROJECTION,
      JSON.stringify({ url, type: "video", title: "Vídeo local", fadeDuration: 250 })
    );
    openAudio.mockRestore();

    await media.openAudio({ url, title: "Vídeo local", mediaType: "video" });

    const identity = h.send.mock.calls.find(
      ([type]) => type === BROADCAST_TYPE.FILE_PROJECTION
    )?.[1] as { playback_id?: string; fadeDuration?: number } | undefined;
    expect(identity).toMatchObject({ playback_id: expect.any(String), fadeDuration: 250 });

    media.goToTime(5);
    media.goToTime(8);
    const states = h.send.mock.calls
      .filter(([type]) => type === BROADCAST_TYPE.VIDEO_STATE)
      .map(([, payload]) => payload as { playback_id?: string; revision?: number });

    expect(states).toHaveLength(2);
    expect(states).toEqual([
      expect.objectContaining({ playback_id: identity?.playback_id, revision: 1 }),
      expect.objectContaining({ playback_id: identity?.playback_id, revision: 2 }),
    ]);

    media.close(true);
  });

  it("responde só ao pedido da reprodução ativa e inclui snapshot pausado versionado", async () => {
    const url = "louvorja://onlinevideo/video-request.mp4";
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => guardado.get(key) ?? null,
      setItem: (key: string, value: string) => void guardado.set(key, value),
      removeItem: (key: string) => void guardado.delete(key),
    });
    localStorage.setItem(
      KEYS.PROJECTION.LJ_FILE_PROJECTION,
      JSON.stringify({ url, type: "video", title: "Vídeo pausado" })
    );
    openAudio.mockRestore();
    await media.openAudio({ url, title: "Vídeo pausado", mediaType: "video" });

    const playbackId = media.getActivePlaybackId();
    expect(playbackId).toEqual(expect.any(String));
    h.send.mockClear();
    const stopListening = listenForVideoStateRequests(Broadcast, media);

    try {
      for (const listener of [...h.listeners]) {
        listener({
          type: BROADCAST_TYPE.REQUEST_VIDEO_STATE,
          payload: { playback_id: "stale-playback" },
        });
      }
      expect(h.send).not.toHaveBeenCalledWith(BROADCAST_TYPE.VIDEO_STATE, expect.anything());

      for (const listener of [...h.listeners]) {
        listener({
          type: BROADCAST_TYPE.REQUEST_VIDEO_STATE,
          payload: { playback_id: playbackId },
        });
      }

      const states = h.send.mock.calls
        .filter(([type]) => type === BROADCAST_TYPE.VIDEO_STATE)
        .map(
          ([, payload]) =>
            payload as {
              playback_id: string;
              revision: number;
              currentTime: number;
              isPaused: boolean;
              playing: boolean;
              position: number;
              clockAnchor: number | null;
            }
        );
      expect(states).toHaveLength(1);
      expect(states[0]).toMatchObject({
        playback_id: playbackId,
        revision: 1,
        currentTime: 0,
        isPaused: true,
        playing: false,
        position: 0,
        clockAnchor: null,
      });
    } finally {
      stopListening();
      media.close(true);
    }
  });
});
