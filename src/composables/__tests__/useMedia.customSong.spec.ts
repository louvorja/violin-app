/**
 * Música personalizada no player: abrir no cantado, no playback ou sem áudio, e
 * trocar de modo com ela no ar — pela mesma função que serve o acervo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { KEYS } from "@/constants/UserDataKeys";
import { MusicActionEnum } from "@/enums/MusicActionEnum";

const h = vi.hoisted(() => ({ warning: vi.fn(), missing: new Set<string>() }));

vi.mock("@/helpers/AudioLibrary", () => {
  const api = {
    resolveAudio: async (token: string) =>
      token && !h.missing.has(token) ? `blob:${token}` : null,
    resolveImage: async () => null,
  };
  return { default: api, ...api };
});
vi.mock("@/helpers/Snackbar", () => ({
  default: { info: vi.fn(), warning: h.warning, error: vi.fn(), show: vi.fn(), success: vi.fn() },
}));
vi.mock("@/helpers/ProjectionWindows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/ProjectionWindows")>()),
  openProjectionWindows: vi.fn(async () => {}),
  closeProjectionWindows: vi.fn(async () => {}),
  closeFileProjectionWindows: vi.fn(async () => {}),
  closeMusicProjectionWindows: vi.fn(async () => {}),
}));

type Media = typeof import("@/composables/useMedia").default;
let media: Media;
// O player guarda estado de módulo: cada teste começa com módulos novos, e os
// que o teste consulta têm de ser os mesmos que o player usa.
let $appdata: typeof import("@/helpers/AppData").default;
let slides: ReturnType<typeof import("@/composables/useSlides").useSlides>;

/** O carregamento da faixa fica pendente: o que interessa aqui é o que o player pediu. */
class PendingXHR {
  responseType = "";
  timeout = 0;
  open() {}
  send() {}
  abort() {}
}

const song = (overrides: Record<string, unknown> = {}) => ({
  id: "song-a",
  nome: "Esperança",
  audio_token: "sung",
  audio_name: "cantado.mp3",
  playback_token: "pb",
  playback_name: "playback.mp3",
  slides: [
    { tipo: "CAPA", letra: "Esperança", tempo_seconds: 0 },
    { tipo: "LETRA", letra: "verso 1", tempo_seconds: 10, tempo_seconds_pb: 14 },
    { tipo: "LETRA", letra: "verso 2", tempo_seconds: 20 },
  ],
  ...overrides,
});

const config = () => media.config() as { mode?: string; audio?: string };
const data = () => $appdata.get(KEYS.MODULES.MEDIA.DATA) as Record<string, unknown>;
/** Início de cada slide na faixa que o player sincroniza. */
const times = () => [0, 1, 2].map((i) => slides.timeForPosition(i, 0, 999));

async function pendingModeSwitch(source: "custom" | "catalog") {
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const audio = (await import("@/composables/useAudioPlayback")).useAudioPlayback();
  $appdata.set(KEYS.SHELL.IS_ONLINE, true);
  if (source === "custom") await media.openCustomSong(song(), MusicActionEnum.NO_AUDIO);
  else {
    const { default: database } = await import("@/helpers/Database");
    const { default: path } = await import("@/helpers/Path");
    vi.spyOn(database, "get").mockResolvedValue({
      id_music: 42,
      name: "Acervo",
      duration: "00:03:00",
      lyric: [],
      url_music: "/test.mp3",
    });
    vi.spyOn(path, "file").mockReturnValue("blob:catalog");
    await media.open({ id_music: 42, mode: MusicActionEnum.NO_AUDIO });
  }
  const prepare = vi.spyOn(audio, "prepare");
  vi.useFakeTimers();
  media.switchMode(MusicActionEnum.AUDIO);
  await vi.advanceTimersByTimeAsync(0);
  expect(prepare).toHaveBeenCalledOnce();
  return { audio, element: load.mock.contexts.at(-1) as HTMLMediaElement };
}

beforeEach(async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal("XMLHttpRequest", PendingXHR);
  h.warning.mockClear();
  h.missing.clear();
  media = (await import("@/composables/useMedia")).default;
  $appdata = (await import("@/helpers/AppData")).default;
  slides = (await import("@/composables/useSlides")).useSlides();
});

afterEach(() => {
  media.close(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("abrir música personalizada", () => {
  it("preserva as linhas principal e auxiliar do .slja até os slides de projeção", async () => {
    const { default: SljaConverter } = await import("@/helpers/SljaConverter");
    const imported = await SljaConverter.loadSlja(new Blob([
      "[Geral]\r\nslides=1\r\n[Slide:1]\r\ntipo=LETRA\r\n" +
      "letra=Ricos e pobres, Plebeus e nobres|Diante do trono de Deus\r\n" +
      "letra_aux=Primeira linha|Segunda linha\r\n",
    ]));
    expect(imported.slides[0].letra).toBe("Ricos e pobres, Plebeus e nobres\nDiante do trono de Deus");
    await media.openCustomSong({ nome: "Hino importado", slides: imported.slides });
    expect(media.slides()[0]).toMatchObject({
      lyric: "Ricos e pobres, Plebeus e nobres<br>Diante do trono de Deus",
      aux_lyric: "Primeira linha<br>Segunda linha",
    });
    // O documento continua em texto: edição/exportação não recebem HTML.
    expect(imported.slides[0].letra_aux).toBe("Primeira linha\nSegunda linha");
  });

  it("mantém linhas vazias e trata a letra personalizada como texto, inclusive na capa", async () => {
    await media.openCustomSong(song({
      nome: "Capa <especial> & título",
      slides: [
        { tipo: "CAPA", letra: "" },
        { tipo: "LETRA", letra: "Um & dois\r\n\r\n<três>\rFim", letra_aux: "<b>Auxiliar</b>\nFim" },
        { tipo: "LETRA", letra: "" },
      ],
    }));
    expect(media.slides()[0].name).toBe("Capa &lt;especial&gt; &amp; título");
    expect(media.slides()[1]).toMatchObject({
      lyric: "Um &amp; dois<br><br>&lt;três&gt;<br>Fim",
      aux_lyric: "&lt;b&gt;Auxiliar&lt;/b&gt;<br>Fim",
    });
    expect(media.slides()[2].lyric).toBe("");
  });

  it("sem modo pedido abre o cantado, e guarda as duas faixas para a troca no ar", async () => {
    expect(await media.openCustomSong(song())).toBe(true);
    expect(config()).toMatchObject({ mode: "audio", audio: "blob:sung" });
    expect(slides.title.value).toBe("Esperança");
    expect(data()).toMatchObject({
      custom: true,
      url_music: "blob:sung",
      url_instrumental_music: "blob:pb",
    });
    expect(times()).toEqual([0, 10, 20]);
  });

  it("no playback toca a faixa de playback com os tempos dela", async () => {
    expect(await media.openCustomSong(song(), MusicActionEnum.INSTRUMENTAL)).toBe(true);
    expect(config()).toMatchObject({ mode: "instrumental", audio: "blob:pb" });
    // O slide sem tempo próprio segue o do cantado.
    expect(times()).toEqual([0, 14, 20]);
  });

  it("sem áudio projeta os slides sem carregar faixa nenhuma", async () => {
    expect(await media.openCustomSong(song(), MusicActionEnum.NO_AUDIO)).toBe(true);
    expect(config()).toMatchObject({ mode: "no_audio", audio: "" });
    expect(data().url_instrumental_music).toBe("blob:pb");
  });

  it("música feita sem áudio entra só com os slides, e o player diz isso", async () => {
    const semAudio = song({ audio_token: "", playback_token: "" });
    expect(await media.openCustomSong(semAudio)).toBe(true);
    expect(config()).toMatchObject({ mode: "no_audio", audio: "" });
  });

  it("playback pedido de quem não tem é recusado sem tirar do ar o que está tocando", async () => {
    await media.openCustomSong(song({ nome: "No ar" }));
    const semPlayback = song({ nome: "Outra", playback_token: "" });

    expect(await media.openCustomSong(semPlayback, MusicActionEnum.INSTRUMENTAL)).toBe(false);
    expect(h.warning).toHaveBeenCalledOnce();
    expect(config()).toMatchObject({ mode: "audio", audio: "blob:sung" });
    expect(slides.title.value).toBe("No ar");
  });

  it("playback cujo arquivo sumiu da biblioteca avisa em vez de tocar a cantada", async () => {
    h.missing.add("pb");
    expect(await media.openCustomSong(song(), MusicActionEnum.INSTRUMENTAL)).toBe(false);
    expect(h.warning).toHaveBeenCalledOnce();
    expect(config().audio).toBe("");
  });
});

describe.each(["custom", "catalog"] as const)("troca de modo pendente (%s)", (source) => {
  it.each(["fechar", "outra música", "sem áudio"])(
    "um timeout antigo não reabre a música depois de %s",
    async (nextAction) => {
      await pendingModeSwitch(source);
      if (nextAction === "fechar") media.close(true);
      else if (nextAction === "outra música")
        await media.openCustomSong(
          song({ id: "song-b", nome: "Outra música" }),
          MusicActionEnum.NO_AUDIO
        );
      else media.switchMode(MusicActionEnum.NO_AUDIO);
      const playback = media.getActivePlaybackId();
      const title = slides.title.value;
      const reopen = vi.spyOn(media, "openCustomSong");
      const reopenCatalog = vi.spyOn(media, "open");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(reopen).not.toHaveBeenCalled();
      expect(reopenCatalog).not.toHaveBeenCalled();
      expect(media.getActivePlaybackId()).toBe(playback);
      expect(slides.title.value).toBe(title);
      expect(config().audio).toBe("");
    }
  );

  it("descarta a faixa que fica pronta depois de escolher sem áudio", async () => {
    const { audio, element } = await pendingModeSwitch(source);
    const takeover = vi.spyOn(audio, "takeOver").mockResolvedValue();
    const release = vi.spyOn(audio, "release");
    media.switchMode(MusicActionEnum.NO_AUDIO);
    const playback = media.getActivePlaybackId();

    element.dispatchEvent(new Event("canplay"));
    await vi.advanceTimersByTimeAsync(0);

    expect(takeover).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(element);
    expect(media.getActivePlaybackId()).toBe(playback);
    expect(config()).toMatchObject({ mode: "no_audio", audio: "" });
  });

  it("mantém a recuperação por reabertura quando o timeout ainda é da tentativa atual", async () => {
    await pendingModeSwitch(source);
    const reopen =
      source === "custom" ? vi.spyOn(media, "openCustomSong") : vi.spyOn(media, "open");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reopen).toHaveBeenCalledOnce();
    expect(config().mode).toBe("audio");
  });
});

describe("trocar de modo com a música personalizada no ar", () => {
  it("do cantado para o playback pede a faixa de playback, sem reabrir a música", async () => {
    await media.openCustomSong(song());
    const reopen = vi.spyOn(media, "openCustomSong");

    media.switchMode(MusicActionEnum.INSTRUMENTAL);

    expect(config()).toMatchObject({ mode: "instrumental", audio: "blob:pb" });
    expect(reopen).not.toHaveBeenCalled();
    // A faixa antiga segue no ar até a nova assumir; os tempos só trocam com ela.
    expect(times()).toEqual([0, 10, 20]);
  });

  it("para sem áudio solta a faixa e mantém os slides", async () => {
    await media.openCustomSong(song());
    media.switchMode(MusicActionEnum.NO_AUDIO);
    expect(config()).toMatchObject({ mode: "no_audio", audio: "" });
    expect(slides.title.value).toBe("Esperança");
    expect(media.slides()).toHaveLength(3);
  });

  it("de sem áudio volta para o cantado", async () => {
    await media.openCustomSong(song(), MusicActionEnum.NO_AUDIO);
    media.switchMode(MusicActionEnum.AUDIO);
    expect(config()).toMatchObject({ mode: "audio", audio: "blob:sung" });
  });

  it("sem playback a troca não muda nada", async () => {
    await media.openCustomSong(song({ playback_token: "" }));
    media.switchMode(MusicActionEnum.INSTRUMENTAL);
    expect(config()).toMatchObject({ mode: "audio", audio: "blob:sung" });
  });

  it("depois de fechar não sobra faixa da música anterior", async () => {
    await media.openCustomSong(song());
    media.close(true);
    media.switchMode(MusicActionEnum.INSTRUMENTAL);
    expect(config().audio).toBe("");
    expect(data().custom).toBeUndefined();
  });
});
