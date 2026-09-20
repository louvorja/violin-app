/**
 * O caminho "baixar e projetar" de um vídeo do YouTube: o que acontece quando o
 * operador cancela, troca de vídeo ou toca outra coisa no meio do download.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const h = vi.hoisted(() => ({
  ensure: vi.fn(),
  cancel: vi.fn(),
  downloaded: false,
  instant: false,
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  openWindows: vi.fn(async () => {}),
  send: vi.fn(),
}));

vi.mock("@/helpers/OnlineVideo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/OnlineVideo")>()),
  ensure: h.ensure,
  cancel: h.cancel,
  downloadEnabled: () => true,
  downloadAvailable: () => true,
  playWhileDownloading: () => h.instant,
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

const ID = "T8YHfGrk3ok";
const OTHER = "jNQXAC9IVRw";
const embed = (id: string) => `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&controls=0`;
const ok = (id: string) => ({ ok: true, id, url: `louvorja://onlinevideo/${id}.mp4`, size: 1, cached: false });
const cancelled = { ok: false, error: { kind: "cancelled", message: "Download cancelado" } };
const tick = () => new Promise((r) => setTimeout(r, 0));

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
  h.cancel.mockReset();
  h.downloaded = false;
  h.instant = false;
  h.info.mockClear();
  h.warning.mockClear();
  h.error.mockClear();
  h.openWindows.mockClear();
  openAudio = vi.spyOn(media, "openAudio").mockResolvedValue(undefined);
});

afterEach(() => {
  openAudio.mockRestore();
});

describe("baixar e projetar", () => {
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

describe("cancelar e tocar de novo", () => {
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

describe("tocar já enquanto baixa (opção do operador)", () => {
  let embedded: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    h.instant = true;
    embedded = vi.spyOn(media, "openEmbeddedYouTube").mockResolvedValue(undefined);
  });
  afterEach(() => embedded.mockRestore());

  it("sem o arquivo: abre o player do YouTube na hora e baixa em segundo plano, sem guardar", async () => {
    const calls = controlledDownloads();
    const opened = await media.openYouTube(embed(ID), "Louvor"); // não espera o download
    expect(opened).toBe(true);
    expect(embedded).toHaveBeenCalledWith(embed(ID), "Louvor");
    expect(calls).toHaveLength(1);
    expect(h.ensure).toHaveBeenCalledWith(ID, expect.any(Function), { background: true, keep: false });
    expect(openAudio).not.toHaveBeenCalled();
  });

  it("terminar de baixar não troca o que já está tocando", async () => {
    const calls = controlledDownloads();
    await media.openYouTube(embed(ID), "Louvor");
    calls[0].done.resolve(ok(ID));
    await tick();
    expect(embedded).toHaveBeenCalledTimes(1);
    expect(openAudio).not.toHaveBeenCalled();
    expect(h.openWindows).not.toHaveBeenCalled();
  });

  it("se o download em segundo plano falha, ninguém é avisado: o vídeo já está tocando", async () => {
    const calls = controlledDownloads();
    await media.openYouTube(embed(ID), "Louvor");
    calls[0].done.resolve({ ok: false, error: { kind: "network", message: "sem rede" } });
    await tick();
    expect(h.warning).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });

  it("com o arquivo já no disco, toca dele mesmo com a opção ligada", async () => {
    h.downloaded = true;
    h.ensure.mockResolvedValue({ ...ok(ID), cached: true });
    expect(await media.openYouTube(embed(ID), "Louvor")).toBe(true);
    expect(embedded).not.toHaveBeenCalled();
    expect(openAudio).toHaveBeenCalledWith(expect.objectContaining({ url: `louvorja://onlinevideo/${ID}.mp4` }));
  });

  it("com a opção desligada, espera o download (o padrão, sem anúncio)", async () => {
    h.instant = false;
    const calls = controlledDownloads();
    let settled = false;
    const opening = media.openYouTube(embed(ID), "Louvor").then((r) => ((settled = true), r));
    await tick();
    expect(settled).toBe(false);
    expect(embedded).not.toHaveBeenCalled();
    calls[0].done.resolve(ok(ID));
    expect(await opening).toBe(true);
    expect(embedded).not.toHaveBeenCalled();
  });

  it("o vídeo que já baixava em segundo plano não dispara outro download ao tocar de novo", async () => {
    const calls = controlledDownloads();
    await media.openYouTube(embed(ID), "Louvor");
    await media.openYouTube(embed(ID), "Louvor"); // o operador clicou de novo
    expect(calls).toHaveLength(1);
    calls[0].done.resolve(ok(ID));
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
});
