/**
 * Abrir um vídeo do YouTube: toca já, das trilhas que o main baixa uma vez só (sem esperar o
 * download nem passar pelo player do YouTube), e o que acontece quando o operador cancela,
 * troca de vídeo ou toca outra coisa no meio. Vídeo só com formatos em fragmentos é baixado
 * pelo yt-dlp, e aí o operador acompanha esse download.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const h = vi.hoisted(() => ({
  ensure: vi.fn(),
  stream: vi.fn(),
  cancel: vi.fn(),
  /** `readyState` e `error` do elemento de mídia principal (o jsdom não decodifica nada). */
  ready: 4,
  mediaError: null as unknown,
  downloaded: false,
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  openWindows: vi.fn(async () => {}),
  send: vi.fn(),
}));

vi.mock("@/helpers/OnlineVideo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/OnlineVideo")>()),
  ensure: h.ensure,
  stream: h.stream,
  cancel: h.cancel,
  downloadEnabled: () => true,
  downloadAvailable: () => true,
  isDownloaded: async () => h.downloaded,
  listFiles: async () => [],
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { info: h.info, warning: h.warning, error: h.error, show: vi.fn(), success: vi.fn() },
}));
vi.mock("@/helpers/ProjectionWindows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/ProjectionWindows")>()),
  openVideoProjectionWindows: h.openWindows,
}));
vi.mock("@/helpers/Broadcast", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/helpers/Broadcast")>();
  return { ...original, default: { ...original.default, send: h.send } };
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
  h.info.mockClear();
  h.warning.mockClear();
  h.error.mockClear();
  h.openWindows.mockClear();
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
    });
  });

  it("cancelado pelo operador: não abre nada, e nenhum aviso de erro", async () => {
    h.ensure.mockResolvedValue(cancelled);
    expect(await media.openYouTube(embed(ID), "Louvor")).toBe(false);
    expect(openAudio).not.toHaveBeenCalled();
    expect(h.warning).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });
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
    });
    // a imagem do player do app vem da trilha de vídeo; o som, da de áudio
    expect(openAudio).toHaveBeenCalledWith({
      url: audio.url,
      title: "Louvor",
      mediaType: "video",
      videoUrl: video.url,
    });
    expect(embedded).not.toHaveBeenCalled();
    // abre direto: nenhum toast de "abrindo" entre o clique e o vídeo
    expect(h.info).not.toHaveBeenCalled();
  });

  it("o vídeo que já estava no disco quando o main foi perguntado toca do arquivo, sem trilhas separadas", async () => {
    const file = `louvorja://onlinevideo/${ID}.mp4`;
    h.stream.mockResolvedValue({ ok: true, id: ID, cached: true, video: { url: file }, audio: { url: file }, muxed: true, duration: null });
    controlledDownloads();
    expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
    expect(openAudio).toHaveBeenCalledWith({ url: file, title: "Louvor", mediaType: "video" });
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
    });
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
    expect(openAudio).toHaveBeenCalledWith(expect.objectContaining({ url: `louvorja://onlinevideo/${ID}.mp4` }));
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
    it("rede ou YouTube fora do ar: cai no player do YouTube, avisa e baixa ao fundo", async () => {
      h.stream.mockResolvedValue(streamFail("network"));
      const calls = controlledDownloads();
      expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
      expect(embedded).toHaveBeenCalledWith(embed(ID), "Louvor");
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
      expect(closed).toHaveBeenCalledWith(true);
      expect(embedded).toHaveBeenCalledWith(embed(ID), "Louvor");
      expect(h.warning).toHaveBeenCalledTimes(1);
      expect(h.ensure).toHaveBeenCalledTimes(1);
      closed.mockRestore();
    });

    it("o elemento de som acusa erro: cai no player do YouTube sem esperar o prazo", async () => {
      h.ready = 0;
      h.mediaError = { code: 4 };
      const closed = vi.spyOn(media, "close").mockImplementation(() => {});
      controlledDownloads();
      expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
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
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ url: `louvorja://onlinevideo/${ID}.mp4` }));
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
    expect(embedded).toHaveBeenCalledWith(embed(ID), "Louvor");
    expect(h.stream).not.toHaveBeenCalled();
    expect(h.ensure).not.toHaveBeenCalled();
    vi.doUnmock("@/helpers/OnlineVideo");
  });
});
