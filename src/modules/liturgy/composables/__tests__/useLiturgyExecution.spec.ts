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
  systemPlayer: false,
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
    set: mocks.userdataSet,
  },
}));
vi.mock("@/composables/useMedia", () => ({
  default: {
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
  default: { send: mocks.broadcastSend, getLastPayload: mocks.broadcastGetLastPayload },
}));
vi.mock("@/helpers/ProjectionWindows", () => ({
  openFileProjectionWindows: vi.fn(async () => {}),
  openAnnouncementsWindow: mocks.openAnnouncementsWindow,
  openSiteWindow: mocks.openSiteWindow,
}));
vi.mock("@/helpers/AppData", () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/helpers/IndexedDB", () => ({ default: { getAll: mocks.idbGetAll } }));
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
vi.mock("@/helpers/Http", () => ({ fetchWithTimeout: vi.fn(), NET_TIMEOUT: { MEDIA: 1 } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), captureException: vi.fn() },
}));

import { useLiturgyExecution } from "../useLiturgyExecution";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { KEYS } from "@/constants/UserDataKeys";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import type { LiturgyItem } from "@/types/Liturgy";
import { DB_TABLE } from "@/constants/DbTables";
import $alert from "@/helpers/Alert";

function arquivo(dir: string, item = "Arquivo"): LiturgyItem {
  return { id: "1", tipo: LiturgyItemTypeEnum.ARQUIVO, item, dir } as LiturgyItem;
}

function site(url: string, item = "Site"): LiturgyItem {
  return { id: "s1", tipo: LiturgyItemTypeEnum.SITE, item, url } as LiturgyItem;
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
  mocks.systemPlayer = false;
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
});

describe("liturgia — arquivo escolhido na web", () => {
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
