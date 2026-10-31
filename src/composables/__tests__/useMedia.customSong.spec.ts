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
