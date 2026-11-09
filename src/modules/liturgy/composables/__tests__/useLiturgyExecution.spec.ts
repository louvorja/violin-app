/** Execução da liturgia: projeção interna e vínculo com sobreposição. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  openSlja: vi.fn(),
  openPath: vi.fn(),
  openAudio: vi.fn(),
  projectFile: vi.fn(),
  openMusic: vi.fn(),
  openCustomSong: vi.fn(),
  openCustomAudio: vi.fn(),
  openYouTube: vi.fn(),
  readAllOverlaySlots: vi.fn(),
  writeOverlaySlot: vi.fn(),
  userdataSet: vi.fn(),
  idbGetAll: vi.fn(),
  resolveLiturgyFile: vi.fn(),
  releaseLiturgyFileUrl: vi.fn(),
  retainLiturgyFileUrl: vi.fn(),
  getCustomSong: vi.fn(),
  resolveAudio: vi.fn(),
  openAnnouncementsWindow: vi.fn(),
  openSiteWindow: vi.fn(),
  closeMedia: vi.fn(),
  closeProjectionStage: vi.fn(async () => {}),
  broadcastSend: vi.fn(),
  broadcastGetLastPayload: vi.fn(),
  broadcastListen: vi.fn(),
  systemPlayer: false,
  stage: 0,
  /** Preferências que um caso queira forçar, lidas antes do `fallback`. */
  userdataValues: new Map<string, unknown>(),
}));

vi.mock("../../i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key }),
  chaveLiturgia: (key: string) => key,
}));
vi.mock("@/helpers/SljaPlayer", () => ({ openSlja: mocks.openSlja, SLJA_EXT: "slja" }));
vi.mock("@/helpers/Platform", () => ({
  default: { isDesktop: true, api: { shell: { openPath: mocks.openPath } } },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) => {
      if (mocks.userdataValues.has(key)) return mocks.userdataValues.get(key);
      return mocks.systemPlayer ? true : fallback;
    },
    set: (key: string, value: unknown) => {
      mocks.userdataSet(key, value);
      mocks.userdataValues.set(key, value);
    },
  },
}));
vi.mock("@/composables/useMedia", () => ({
  default: {
    captureStageGuard: () => {
      const stage = mocks.stage;
      return () => stage === mocks.stage;
    },
    close: mocks.closeMedia,
    stop: vi.fn(),
    open: mocks.openMusic,
    openCustomSong: mocks.openCustomSong,
    openCustomAudio: mocks.openCustomAudio,
    openYouTube: mocks.openYouTube,
    closeProjectionStage: mocks.closeProjectionStage,
    openAudio: mocks.openAudio,
    projectFile: mocks.projectFile,
  },
}));
vi.mock("@/composables/useBackgroundSound", () => ({
  useBackgroundSound: () => ({ currentFile: { value: null } }),
}));
vi.mock("@/composables/useFileProjection", () => ({
  useFileProjection: () => ({ start: vi.fn() }),
}));
/*
 * Só o que o composable chama. `validateUrl` copia a regra de
 * `src/helpers/Liturgy.ts`: sem o mock o item Site lançava TypeError e o
 * executeItem engolia o erro, sem abrir janela nenhuma.
 */
vi.mock("@/helpers/Liturgy", () => ({
  default: {
    validateUrl: (url: string) =>
      !url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("ftp://")
        ? url
        : `http://${url}`,
  },
}));
vi.mock("@/helpers/ImageConvert", () => ({ heicToJpeg: vi.fn() }));
vi.mock("@/helpers/Alert", () => ({ default: { error: vi.fn(), info: vi.fn(), show: vi.fn() } }));
vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: mocks.broadcastSend,
    getLastPayload: mocks.broadcastGetLastPayload,
    listen: (handler: (_msg: unknown) => void, options: unknown) => {
      mocks.broadcastListen(handler, options);
      return () => {};
    },
  },
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  openFileProjectionWindows: vi.fn(async () => {}),
  openAnnouncementsWindow: mocks.openAnnouncementsWindow,
  openSiteWindow: mocks.openSiteWindow,
}));
vi.mock("@/helpers/AppData", () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/helpers/IndexedDB", () => ({
  default: { getAll: mocks.idbGetAll, rewriteRecords: vi.fn(async () => 0) },
}));
vi.mock("@/helpers/Overlay", () => ({
  readAllSlots: mocks.readAllOverlaySlots,
  writeSlot: mocks.writeOverlaySlot,
}));
vi.mock("@/helpers/CustomSongs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/CustomSongs")>()),
  getSong: mocks.getCustomSong,
}));
vi.mock("@/helpers/AudioLibrary", () => ({ resolveAudio: mocks.resolveAudio }));
vi.mock("@/helpers/LiturgyFiles", () => ({
  resolveLiturgyFile: mocks.resolveLiturgyFile,
  releaseLiturgyFileUrl: mocks.releaseLiturgyFileUrl,
  retainLiturgyFileUrl: mocks.retainLiturgyFileUrl,
}));
vi.mock("@/helpers/Http", () => ({
  fetchWithTimeout: vi.fn(),
  NET_TIMEOUT: { MEDIA: 1, QUICK: 1 },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), captureException: vi.fn() },
}));

import { useLiturgyExecution } from "../useLiturgyExecution";
import { resetarSessaoOverlayVinculado } from "../../linkedOverlay";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { KEYS } from "@/constants/UserDataKeys";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import type { LiturgyItem } from "@/types/Liturgy";
import { DB_TABLE } from "@/constants/DbTables";
import $alert from "@/helpers/Alert";
import { fetchWithTimeout } from "@/helpers/Http";
import Telemetry from "@/helpers/Telemetry";
import Platform from "@/helpers/Platform";

function arquivo(dir: string, item = "Arquivo"): LiturgyItem {
  return { id: "1", tipo: LiturgyItemTypeEnum.ARQUIVO, item, dir } as LiturgyItem;
}

function site(url: string, item = "Site"): LiturgyItem {
  return { id: "s1", tipo: LiturgyItemTypeEnum.SITE, item, url } as LiturgyItem;
}

function onlineVideo(item = "Item da liturgia", subitem = "Título do YouTube"): LiturgyItem {
  return {
    id: "v1",
    tipo: LiturgyItemTypeEnum.VIDEO_ONLINE,
    item,
    subitem,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  } as LiturgyItem;
}

function linked(item: LiturgyItem): LiturgyItem {
  return { ...item, linked_overlay_id: "slot-1" };
}

function music(mode = "sung"): LiturgyItem {
  return linked({
    id: "music-1",
    tipo: LiturgyItemTypeEnum.MUSICA,
    item: "Hino",
    id_music: 42,
    subtipo: mode,
    escolha: false,
  } as LiturgyItem);
}

beforeEach(() => {
  vi.clearAllMocks();
  Platform.isDesktop = true;
  resetarSessaoOverlayVinculado();
  mocks.systemPlayer = false;
  mocks.stage = 0;
  mocks.userdataValues.clear();
  mocks.openSlja.mockResolvedValue(true);
  mocks.openPath.mockResolvedValue({ ok: true });
  mocks.openAudio.mockResolvedValue(undefined);
  mocks.projectFile.mockResolvedValue(true);
  mocks.openMusic.mockResolvedValue(true);
  mocks.openCustomSong.mockResolvedValue(true);
  mocks.openCustomAudio.mockResolvedValue(true);
  mocks.openYouTube.mockResolvedValue(true);
  mocks.readAllOverlaySlots.mockResolvedValue([{ id: "slot-1", enabled: false }]);
  mocks.writeOverlaySlot.mockResolvedValue(undefined);
  mocks.idbGetAll.mockResolvedValue([]);
  mocks.getCustomSong.mockResolvedValue(null);
  mocks.resolveAudio.mockResolvedValue(null);
  mocks.resolveLiturgyFile.mockResolvedValue(null);
  mocks.openAnnouncementsWindow.mockResolvedValue(true);
  mocks.openSiteWindow.mockResolvedValue(true);
  mocks.closeMedia.mockClear();
  mocks.closeProjectionStage.mockClear();
  mocks.broadcastGetLastPayload.mockReturnValue(null);
  vi.mocked(fetchWithTimeout).mockResolvedValue({
    ok: true,
    status: 206,
    body: { cancel: vi.fn(async () => {}) },
  } as unknown as Response);
});

describe("liturgia — arquivo escolhido na web", () => {
  it.each([
    "G:\\Meu Drive\\Culto\\Informativo.mp4",
    "\\\\servidor\\culto\\aviso.png",
    "file:///C:/Culto/aviso.pdf",
    "louvorja://local/Users/operador/aviso.png",
  ])("orienta a escolher novamente o arquivo local importado na web: %s", async (dir) => {
    Platform.isDesktop = false;
    const ui = useLiturgyExecution();
    await ui.executeItem(arquivo(dir));
    expect($alert.error).toHaveBeenCalledWith({ text: "alerts.file_choose_again_web" });
    expect(mocks.projectFile).not.toHaveBeenCalled();
    expect(mocks.openAudio).not.toHaveBeenCalled();
    expect(Telemetry.captureException).not.toHaveBeenCalled();
  });

  it("projeta bytes locais pela referência após reabrir, sem tratar o nome como caminho", async () => {
    mocks.resolveLiturgyFile.mockResolvedValue({
      url: "blob:local",
      name: "aviso.png",
      kind: "image",
    });
    const ui = useLiturgyExecution();
    expect(await ui.openFile({ ...arquivo("aviso.png"), ref_id: "file-1" })).toBe(true);
    expect(mocks.resolveLiturgyFile).toHaveBeenCalledWith("file-1");
    expect(mocks.projectFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "blob:local",
        type: "image",
        libRef: { table: DB_TABLE.LITURGY_FILES, id: "file-1" },
      })
    );
    expect($alert.error).not.toHaveBeenCalled();
  });

  it("solicita áudio local e abre .slja dentro do app", async () => {
    const ui = useLiturgyExecution();
    mocks.resolveLiturgyFile.mockResolvedValue({
      url: "blob:audio",
      name: "hino.mp3",
      kind: "audio",
    });
    await ui.openFile({ ...arquivo("hino.mp3"), ref_id: "audio-1" });
    expect(mocks.openAudio).toHaveBeenCalledWith(
      expect.objectContaining({ url: "blob:audio", mediaType: "audio" })
    );
    mocks.resolveLiturgyFile.mockResolvedValue({
      url: "blob:slja",
      name: "hino.slja",
      kind: "slja",
    });
    await ui.openFile({ ...arquivo("hino.slja"), ref_id: "slja-1" });
    expect(mocks.openSlja).toHaveBeenCalledWith(
      "blob:slja",
      expect.objectContaining({ origin: "liturgy" })
    );
  });

  it("uma abertura antiga que termina depois não substitui a URL do áudio mais novo", async () => {
    let finishOld!: () => void;
    mocks.openAudio.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOld = resolve;
        })
    );
    mocks.resolveLiturgyFile
      .mockResolvedValueOnce({ url: "blob:old", name: "old.mp3", kind: "audio" })
      .mockResolvedValueOnce({ url: "blob:new", name: "new.mp3", kind: "audio" });
    const ui = useLiturgyExecution();
    const old = ui.openFile({ ...arquivo("old.mp3"), ref_id: "old" });
    await vi.waitFor(() => expect(mocks.openAudio).toHaveBeenCalledOnce());
    await ui.openFile({ ...arquivo("new.mp3"), ref_id: "new" });
    finishOld();
    await old;
    expect(mocks.retainLiturgyFileUrl).toHaveBeenCalledExactlyOnceWith("blob:new", "audio");
    expect(mocks.releaseLiturgyFileUrl).toHaveBeenCalledWith("blob:old");
  });

  it("avisa quando os bytes faltam e preserva caminhos desktop sem ref_id", async () => {
    const ui = useLiturgyExecution();
    expect(await ui.openFile({ ...arquivo("aviso.png"), ref_id: "missing" })).toBe(false);
    expect($alert.error).toHaveBeenCalledOnce();
    expect(mocks.projectFile).not.toHaveBeenCalled();
    mocks.resolveLiturgyFile.mockClear();
    expect(await ui.openFile(arquivo("C:\\LouvorJA\\aviso.png"))).toBe(true);
    expect(mocks.resolveLiturgyFile).not.toHaveBeenCalled();
    expect(mocks.projectFile).toHaveBeenCalledWith(expect.objectContaining({ type: "image" }));
  });
});

describe("liturgia — item de arquivo .slja", () => {
  it.each([true, false])(
    "resposta tardia do programa externo (ok=%s) não altera o arquivo mais novo",
    async (ok) => {
      mocks.systemPlayer = true;
      let finish!: (_result: { ok: boolean }) => void;
      mocks.openPath.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const ui = useLiturgyExecution();
      const old = ui.openFile(arquivo("/old.mp4"));
      await vi.waitFor(() => expect(mocks.openPath).toHaveBeenCalledOnce());
      await ui.openFile(arquivo("/new.png"));
      finish({ ok });
      await old;
      expect(mocks.projectFile).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ url: "louvorja://local/new.png" })
      );
      expect(mocks.closeMedia).not.toHaveBeenCalled();
      expect(mocks.openAudio).not.toHaveBeenCalled();
    }
  );

  it("não abre fallback tardio quando outra ação já mudou o palco", async () => {
    mocks.systemPlayer = true;
    let reject!: (_error: Error) => void;
    mocks.openPath.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    const old = useLiturgyExecution().openFile(arquivo("/old.mp4"));
    await vi.waitFor(() => expect(mocks.openPath).toHaveBeenCalledOnce());
    mocks.stage++;
    reject(new Error("reply was never sent"));
    await old;
    expect(mocks.projectFile).not.toHaveBeenCalled();
    expect(mocks.closeMedia).not.toHaveBeenCalled();
  });

  it("apresenta dentro do app, sem entregar ao sistema", async () => {
    const { executeItem } = useLiturgyExecution();

    await executeItem(arquivo("C:\\Culto\\hino.slja", "Hino de abertura"));

    expect(mocks.openSlja).toHaveBeenCalledTimes(1);
    expect(mocks.openSlja).toHaveBeenCalledWith("louvorja://local/C:/Culto/hino.slja", {
      title: "Hino de abertura",
      origin: "liturgy",
    });
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("caminho Unix e extensão em maiúsculas também ficam no app", async () => {
    const { executeItem } = useLiturgyExecution();

    await executeItem(arquivo("/Users/ana/Slides/Anúncios.SLJA"));

    expect(mocks.openSlja).toHaveBeenCalledTimes(1);
    expect(mocks.openSlja.mock.calls[0][0]).toBe(
      "louvorja://local/Users/ana/Slides/An%C3%BAncios.SLJA"
    );
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("com o reprodutor do sistema ligado, .slja continua no app", async () => {
    mocks.systemPlayer = true;
    const { executeItem } = useLiturgyExecution();

    await executeItem(arquivo("/Users/ana/hino.slja"));

    expect(mocks.openSlja).toHaveBeenCalledTimes(1);
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("controle: com a preferência ligada, um vídeo ainda vai para o sistema", async () => {
    mocks.systemPlayer = true;
    const { executeItem } = useLiturgyExecution();

    await executeItem(arquivo("/Users/ana/aviso.mp4"));

    expect(mocks.openPath).toHaveBeenCalledWith("/Users/ana/aviso.mp4");
    expect(mocks.openSlja).not.toHaveBeenCalled();
  });

  it("imagem e vídeo passam pela posse de palco compartilhada antes de publicar", async () => {
    const { executeItem } = useLiturgyExecution();
    await executeItem(arquivo("/Users/ana/aviso.png", "Aviso"));
    expect(mocks.projectFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image", title: "Aviso" })
    );

    await executeItem(arquivo("/Users/ana/aviso.mp4", "Vídeo"));
    expect(mocks.projectFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "video", title: "Vídeo" }),
      expect.any(String)
    );
  });
});

describe("liturgia — item de site", () => {
  it("abre a URL na janela de projeção do app, não no navegador do sistema", async () => {
    /*
     * Antes o site saía da tela do operador para o navegador do sistema e o
     * telão ficava sem nada — não era projeção.
     */
    const navegador = vi.spyOn(window, "open").mockImplementation(() => null);
    const { executeItem } = useLiturgyExecution();

    await executeItem(site("https://exemplo.com/enquete"));

    expect(mocks.openSiteWindow).toHaveBeenCalledWith("https://exemplo.com/enquete", "liturgy");
    expect(navegador).not.toHaveBeenCalled();
    navegador.mockRestore();
  });

  it("abrir o site encerra o que estava projetado, e espera as janelas saírem", async () => {
    /*
     * Exclusão mútua: só um item no telão.
     *
     * `close(true)` faz o trabalho síncrono (para o áudio e zera o estado) mas
     * só ENFILEIRA o fechamento; a espera é da MESMA fila — sem ela a URL
     * abriria por cima do que ainda está saindo. A ordem tem que ser exatamente
     * esta: fechar, esperar a fila, abrir.
     */
    const { executeItem } = useLiturgyExecution();

    await executeItem(site("https://exemplo.com/enquete"));

    expect(mocks.closeMedia).toHaveBeenCalledWith(true);
    expect(mocks.closeProjectionStage).toHaveBeenCalledTimes(1);
    expect(mocks.openSiteWindow).toHaveBeenCalledTimes(1);
    const aoFechar = mocks.closeProjectionStage.mock.invocationCallOrder[0];
    const aoAbrir = mocks.openSiteWindow.mock.invocationCallOrder[0];
    expect(aoFechar).toBeLessThan(aoAbrir);
  });

  it("URL sem protocolo ganha o http:// antes de ir para a janela", async () => {
    const { executeItem } = useLiturgyExecution();

    await executeItem(site("exemplo.com/enquete"));

    expect(mocks.openSiteWindow).toHaveBeenCalledWith("http://exemplo.com/enquete", "liturgy");
  });

  it("sem URL não abre janela nenhuma", async () => {
    const { executeItem } = useLiturgyExecution();

    await executeItem(site(""));

    expect(mocks.openSiteWindow).not.toHaveBeenCalled();
  });

  it("com a opção 'Link no navegador', o YouTube segue para o navegador", async () => {
    /*
     * A opção existe desde antes da janela de projeção: quem escolheu "link"
     * tem direito ao navegador, e não a uma janela de projeção.
     */
    mocks.userdataValues.set(KEYS.OPTIONS.YOUTUBE_ACTION, "link");
    const navegador = vi.spyOn(window, "open").mockImplementation(() => null);
    const { executeItem } = useLiturgyExecution();

    await executeItem(site("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));

    expect(navegador).toHaveBeenCalledTimes(1);
    expect(mocks.openSiteWindow).not.toHaveBeenCalled();
    expect(mocks.openYouTube).not.toHaveBeenCalled();
    navegador.mockRestore();
  });

  it("YouTube com a preferência padrão segue para o player, não para a janela de site", async () => {
    /*
     * O item Site serve de porta para link de vídeo: quando o operador prefere
     * vídeo, ele toca dentro do app e a janela de site não entra.
     */
    const { executeItem } = useLiturgyExecution();

    await executeItem(site("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));

    expect(mocks.openYouTube).toHaveBeenCalledTimes(1);
    expect(mocks.openSiteWindow).not.toHaveBeenCalled();
  });

  it("vídeo da coletânea usa o título do YouTube, não o nome do item litúrgico", async () => {
    const { executeItem } = useLiturgyExecution();

    await executeItem(onlineVideo("Abertura do culto", "Título do YouTube"));

    expect(mocks.openYouTube).toHaveBeenCalledWith(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&controls=0",
      "Título do YouTube"
    );
  });
});

describe("liturgia — vínculo de sobreposição", () => {
  it("liga o slot apenas depois de a projeção da imagem confirmar sucesso", async () => {
    let finishProjection!: (_success: boolean) => void;
    mocks.projectFile.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishProjection = resolve;
      })
    );

    const { executeItem } = useLiturgyExecution();
    const execution = executeItem(linked(arquivo("/Users/ana/aviso.png")));
    await vi.waitFor(() => expect(mocks.projectFile).toHaveBeenCalledTimes(1));
    expect(mocks.writeOverlaySlot).not.toHaveBeenCalled();

    finishProjection(true);
    await execution;
    expect(mocks.writeOverlaySlot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "slot-1", enabled: true })
    );
    expect(mocks.userdataSet).toHaveBeenCalledWith(KEYS.MODULES.OVERLAY.ENABLED, true);
  });

  it("não liga o slot quando a projeção falha ou o arquivo abre fora do app", async () => {
    const { executeItem } = useLiturgyExecution();
    mocks.projectFile.mockResolvedValueOnce(false);
    await executeItem(linked(arquivo("/Users/ana/aviso.png")));

    mocks.openSlja.mockResolvedValueOnce(false);
    await executeItem(linked(arquivo("/Users/ana/slides.slja")));

    mocks.systemPlayer = true;
    await executeItem(linked(arquivo("/Users/ana/aviso.mp4")));

    expect(mocks.openPath).toHaveBeenCalledWith("/Users/ana/aviso.mp4");
    expect(mocks.writeOverlaySlot).not.toHaveBeenCalled();
    expect(mocks.userdataSet).not.toHaveBeenCalled();
  });

  it("arquivo local ausente não abre projeção e avisa o caminho salvo", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce({
      ok: false,
      status: 404,
      body: { cancel: vi.fn(async () => {}) },
    } as unknown as Response);
    const { executeItem } = useLiturgyExecution();

    await executeItem(arquivo("/Users/ana/nao-existe.mp4"));

    expect(mocks.projectFile).not.toHaveBeenCalled();
    expect(mocks.openAudio).not.toHaveBeenCalled();
    expect($alert.error).toHaveBeenCalledWith({
      text: "/Users/ana/nao-existe.mp4",
      title: "modules.media.alerts.file_not_found",
    });
  });

  it("não liga o slot para áudio ou para anúncios sem slides selecionados", async () => {
    const { executeItem } = useLiturgyExecution();
    await executeItem(linked(arquivo("/Users/ana/audio.mp3")));
    mocks.idbGetAll.mockResolvedValueOnce([
      { id: "slide-1", nome: "Aviso", ordem: 1, texto: "Olá" },
    ]);
    await executeItem(
      linked({
        id: "announcements-1",
        tipo: LiturgyItemTypeEnum.ANUNCIOS,
        anuncios_ids: [],
      } as unknown as LiturgyItem)
    );

    expect(mocks.openAudio).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastSend).not.toHaveBeenCalled();
    expect(mocks.writeOverlaySlot).not.toHaveBeenCalled();
  });

  it("só liga o slot de anúncios se a janela de projeção realmente abrir", async () => {
    const { executeItem } = useLiturgyExecution();
    const announcement = linked({
      id: "announcements-2",
      tipo: LiturgyItemTypeEnum.ANUNCIOS,
      anuncios_ids: ["slide-1"],
    } as unknown as LiturgyItem);
    mocks.idbGetAll.mockResolvedValue([{ id: "slide-1", nome: "Aviso", ordem: 1, texto: "Olá" }]);
    mocks.broadcastGetLastPayload.mockImplementation(() => {
      const intent = mocks.broadcastSend.mock.calls.find(
        ([type]) => type === BROADCAST_TYPE.ANNOUNCEMENTS_INTENT
      );
      return intent?.[1] ?? null;
    });

    mocks.openAnnouncementsWindow.mockResolvedValueOnce(false);
    await executeItem(announcement);
    expect(mocks.openAnnouncementsWindow).toHaveBeenCalledTimes(1);
    expect(mocks.writeOverlaySlot).not.toHaveBeenCalled();

    mocks.broadcastSend.mockClear();
    await executeItem(announcement);
    expect(mocks.writeOverlaySlot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "slot-1", enabled: true })
    );
  });

  it("liga o slot ao tocar diretamente uma música visual, mas não a faixa só em áudio", async () => {
    const { playMusic } = useLiturgyExecution();
    expect(await playMusic(music("sung"), "sung")).toBe(true);
    expect(mocks.writeOverlaySlot).toHaveBeenCalledTimes(1);

    mocks.writeOverlaySlot.mockClear();
    mocks.userdataSet.mockClear();
    expect(await playMusic(music("audio"), "audio")).toBe(false);
    expect(mocks.openAudio).toHaveBeenCalledTimes(1);
    expect(mocks.writeOverlaySlot).not.toHaveBeenCalled();
    expect(mocks.userdataSet).not.toHaveBeenCalled();
  });

  it("não liga o slot se a música visual não iniciar a projeção", async () => {
    mocks.openMusic.mockResolvedValueOnce(false);
    const { playMusic } = useLiturgyExecution();

    expect(await playMusic(music("lyric"), "lyric")).toBe(false);
    expect(mocks.writeOverlaySlot).not.toHaveBeenCalled();
    expect(mocks.userdataSet).not.toHaveBeenCalled();
  });

  const customSong = {
    id: "custom-1",
    nome: "Canção personalizada",
    audio_token: "audio:custom-1",
    playback_token: "audio:custom-1-pb",
  };
  const customMusic = (subtipo: string) =>
    linked({
      id: "music-custom",
      tipo: LiturgyItemTypeEnum.MUSICA,
      item: "Canção personalizada",
      id_music: -2,
      ref_id: "custom-1",
      subtipo,
      escolha: false,
    } as LiturgyItem);

  it("música personalizada só em áudio não abre slides nem liga o slot", async () => {
    mocks.getCustomSong.mockResolvedValue(customSong);
    const { playMusic } = useLiturgyExecution();

    expect(await playMusic(customMusic("audio"), "audio")).toBe(false);
    expect(mocks.openCustomAudio).toHaveBeenCalledWith(customSong, "audio");
    expect(mocks.openCustomSong).not.toHaveBeenCalled();
    expect(mocks.writeOverlaySlot).not.toHaveBeenCalled();

    expect(await playMusic(customMusic("audio_pb"), "audio_pb")).toBe(false);
    expect(mocks.openCustomAudio).toHaveBeenLastCalledWith(customSong, "instrumental");
  });

  it.each([
    ["sung", "audio"],
    ["pb", "instrumental"],
    ["lyric", "no_audio"],
    ["no_audio", "no_audio"],
  ])("música personalizada na versão %s abre os slides no modo %s", async (version, mode) => {
    mocks.getCustomSong.mockResolvedValue(customSong);
    const { playMusic } = useLiturgyExecution();

    expect(await playMusic(customMusic(version), version)).toBe(true);
    expect(mocks.openCustomSong).toHaveBeenCalledWith(customSong, mode);
    expect(mocks.openMusic).not.toHaveBeenCalled();
    expect(mocks.openCustomAudio).not.toHaveBeenCalled();
  });
});

describe("liturgia — ciclo de vida do overlay vinculado", () => {
  let slots: { id: string; enabled: boolean }[];

  beforeEach(() => {
    slots = [{ id: "slot-1", enabled: false }];
    mocks.readAllOverlaySlots.mockImplementation(async () => slots.map((slot) => ({ ...slot })));
    mocks.writeOverlaySlot.mockImplementation(async (slot: { id: string; enabled: boolean }) => {
      const indice = slots.findIndex((atual) => atual.id === slot.id);
      if (indice >= 0) slots[indice] = { ...slot };
    });
    slots = [{ id: "slot-1", enabled: false }];
  });

  it("executar outro item que assume o telão desliga o overlay do anterior", async () => {
    const { executeItem } = useLiturgyExecution();
    await executeItem(linked(arquivo("/Users/ana/aviso.png")));
    expect(slots[0].enabled).toBe(true);

    mocks.writeOverlaySlot.mockClear();
    mocks.userdataSet.mockClear();

    /* Outra imagem, sem vínculo: assume o telão e recolhe o anterior. */
    await executeItem({ ...arquivo("/Users/ana/outra.png"), id: "2" });

    expect(slots[0].enabled).toBe(false);
    expect(mocks.writeOverlaySlot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "slot-1", enabled: false })
    );
    /* A chave geral foi ligada pelo item: volta a desligar. */
    expect(mocks.userdataSet).toHaveBeenCalledWith(KEYS.MODULES.OVERLAY.ENABLED, false);
  });

  it("fechar a mídia desliga o overlay vinculado", async () => {
    const { executeItem } = useLiturgyExecution();
    await executeItem(linked(arquivo("/Users/ana/aviso.png")));
    expect(slots[0].enabled).toBe(true);

    const listener = mocks.broadcastListen.mock.calls[0]?.[0] as (_msg: unknown) => void;
    expect(listener).toBeTypeOf("function");
    listener({ type: BROADCAST_TYPE.MEDIA_CLOSE });

    await vi.waitFor(() => expect(slots[0].enabled).toBe(false));
    expect(mocks.userdataSet).toHaveBeenCalledWith(KEYS.MODULES.OVERLAY.ENABLED, false);
  });

  it("anotação, botão de overlay e som de fundo não encerram o item", async () => {
    const { executeItem } = useLiturgyExecution();
    await executeItem(linked(arquivo("/Users/ana/aviso.png")));
    expect(slots[0].enabled).toBe(true);

    await executeItem({
      id: "nota-1",
      tipo: LiturgyItemTypeEnum.ANOTACAO,
      item: "Lembrete",
      subitem: "Avisar o pastor",
    } as LiturgyItem);
    expect(slots[0].enabled).toBe(true);

    await executeItem({
      id: "overlay-1",
      tipo: LiturgyItemTypeEnum.OVERLAY,
      overlay_id: "slot-2",
      overlay_action: "activate",
    } as unknown as LiturgyItem);
    expect(slots[0].enabled).toBe(true);

    await executeItem({
      id: "bg-1",
      tipo: LiturgyItemTypeEnum.BG_SOUND,
      ref_id: "",
    } as unknown as LiturgyItem);
    expect(slots[0].enabled).toBe(true);
  });

  it("versão só de áudio da mesma música não desliga o overlay", async () => {
    const { playMusic } = useLiturgyExecution();
    await playMusic(music("sung"), "sung");
    expect(slots[0].enabled).toBe(true);

    await playMusic(music("sung"), "audio");
    expect(mocks.openAudio).toHaveBeenCalledTimes(1);
    expect(slots[0].enabled).toBe(true);
  });

  it("trocar a versão da mesma música não reescreve o overlay (sem piscar)", async () => {
    const { playMusic } = useLiturgyExecution();
    await playMusic(music("sung"), "sung");
    mocks.writeOverlaySlot.mockClear();

    await playMusic(music("sung"), "lyric");

    expect(mocks.writeOverlaySlot).not.toHaveBeenCalled();
  });
});

describe("liturgia — 'não encontrado' só quando o arquivo não existe", () => {
  const responde = (status: number) =>
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce({
      ok: status < 300,
      status,
      body: { cancel: vi.fn(async () => {}) },
    } as unknown as Response);

  it("arquivo ausente avisa 'não encontrado' e não vira exceção", async () => {
    responde(404);
    const ui = useLiturgyExecution();
    expect(await ui.openFile(arquivo("/Users/ana/sumiu.mp4"))).toBe(false);
    expect($alert.error).toHaveBeenCalledWith({
      text: "/Users/ana/sumiu.mp4",
      title: "modules.media.alerts.file_not_found",
    });
    expect(Telemetry.track).toHaveBeenCalledWith("liturgy_resource_missing", {
      operation: "open_file",
      resource: "file",
    });
    expect(Telemetry.captureException).not.toHaveBeenCalled();
  });

  it.each([
    [403, "permission"],
    [500, "unreadable"],
  ])("status %i não é 'não encontrado': motivo próprio e erro registrado", async (status, motivo) => {
    responde(status);
    const ui = useLiturgyExecution();
    expect(await ui.openFile(arquivo("/Users/ana/Informativo.mp4"))).toBe(false);
    expect(mocks.projectFile).not.toHaveBeenCalled();
    expect($alert.error).toHaveBeenCalledWith({
      text: "/Users/ana/Informativo.mp4",
      title: `modules.media.alerts.file_${motivo}`,
    });
    expect(Telemetry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        source: "liturgy.execution.open_file_access",
        file_status: motivo,
        file_basename: "Informativo.mp4",
      })
    );
  });

  it("disco que não responde no prazo tem aviso próprio", async () => {
    vi.mocked(fetchWithTimeout).mockRejectedValueOnce(
      Object.assign(new Error("Timeout"), { name: "TimeoutError" })
    );
    const ui = useLiturgyExecution();
    expect(await ui.openFile(arquivo("G:\\Meu Drive\\Informativo.mp4"))).toBe(false);
    expect($alert.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: "modules.media.alerts.file_timeout" })
    );
  });

  it("tipo que o app não abre não é 'não encontrado'", async () => {
    const ui = useLiturgyExecution();
    expect(await ui.openFile(arquivo("/Users/ana/planilha.xlsx"), "document")).toBe(false);
    expect($alert.error).toHaveBeenCalledWith({
      text: "/Users/ana/planilha.xlsx",
      title: "modules.media.alerts.file_unsupported",
    });
    expect(Telemetry.track).toHaveBeenCalledWith("liturgy_file_unsupported", {
      operation: "open_file",
      extension: "xlsx",
      kind: "document",
    });
  });
});
