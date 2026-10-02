import { describe, expect, it } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { ProgramItem } from "@/types/Presentation";
import type { LibraryEntry } from "../../composables/useFileLibrary";
import { liturgyItem } from "../liturgy";
import { expectationOf, isOnAir, samePlayable, type LiveSignal } from "../playable";

const entry = (path: string): LibraryEntry => ({
  name: path.split("/").pop() ?? path,
  path,
  isDir: false,
  ext: path.split(".").pop() ?? "",
  size: 0,
  mtimeMs: 0,
});

const music = (id: number, subtipo = "sung"): ProgramItem => ({
  id: "m",
  kind: "music",
  title: "Hino",
  plannedMinutes: 3,
  source: liturgyItem({ id: "s", tipo: LiturgyItemTypeEnum.MUSICA, subtipo, id_music: id, musica: id, item: "Hino" }),
});

const signal = (s: Partial<LiveSignal>): LiveSignal => ({
  kind: null,
  audio: false,
  songId: null,
  customSongId: null,
  passage: null,
  videoId: null,
  ...s,
});

const verse = (verses: number[], reference = "João 3:16 (NVI)") =>
  ({ type: "bible", ref: { reference, text: "", book_id: 43, chapter: 3, verses, version_id: 1 } }) as const;

describe("samePlayable", () => {
  it("compara arquivo pelo caminho, não pelo nome", () => {
    const a = { type: "file", entry: entry("/Anúncios/Todos.png") } as const;
    const b = { type: "file", entry: entry("/Jovens/Todos.png") } as const;
    expect(samePlayable(a, b)).toBe(false);
    expect(samePlayable(a, { type: "file", entry: entry("/Anúncios/Todos.png") })).toBe(true);
  });

  it("tipos diferentes nunca são o mesmo", () => {
    expect(samePlayable({ type: "program", itemId: "1" }, { type: "song", id_music: 1, title: "" })).toBe(false);
  });
});

describe("Bíblia", () => {
  it("o mesmo trecho é o mesmo Playable; outro versículo não é", () => {
    expect(samePlayable(verse([16]), verse([16]))).toBe(true);
    expect(samePlayable(verse([16]), verse([17]))).toBe(false);
  });

  it("só está no ar enquanto o trecho no ar for o enviado", () => {
    const expected = expectationOf(verse([16]), null);
    const onAir = (verses: number[], version_id?: number) =>
      isOnAir(expected, signal({ kind: "bible", passage: { book_id: 43, chapter: 3, verses, version_id } }));
    expect(onAir([16], 1)).toBe(true);
    expect(onAir([17], 1)).toBe(false);
    expect(onAir([16], 2)).toBe(false);
    // O pacote sem versão (outro módulo) ainda confirma o trecho.
    expect(onAir([16])).toBe(true);
  });
});

describe("expectationOf + isOnAir", () => {
  it("música do programa só está no ar com os slides dela", () => {
    const expected = expectationOf({ type: "program", itemId: "m" }, music(42), undefined);
    expect(isOnAir(expected, signal({ kind: "music", songId: 42 }))).toBe(true);
    expect(isOnAir(expected, signal({ kind: "music", songId: 7 }))).toBe(false);
  });

  it("música só em áudio espera o player de áudio", () => {
    const expected = expectationOf({ type: "program", itemId: "m" }, music(42, "audio"), undefined);
    expect(isOnAir(expected, signal({ audio: true }))).toBe(true);
    expect(isOnAir(expected, signal({ kind: "music", songId: 42 }))).toBe(false);
  });

  it("arquivo da biblioteca deixa de estar no ar quando outro conteúdo assume", () => {
    const expected = expectationOf({ type: "file", entry: entry("/a/aviso.png") }, null);
    expect(isOnAir(expected, signal({ kind: "file" }))).toBe(true);
    expect(isOnAir(expected, signal({ kind: "bible" }))).toBe(false);
    expect(isOnAir(expected, signal({}))).toBe(false);
  });

  it("música do acervo respeita o formato escolhido", () => {
    const song = { type: "song", id_music: 5, title: "x" } as const;
    expect(expectationOf(song, null, "audio_pb")).toEqual({ kind: "audio" });
    expect(expectationOf(song, null, "lyric")).toEqual({ kind: "music", songId: 5 });
  });

  it("item sem efeito acompanhado vale enquanto houver algo no ar", () => {
    const note: ProgramItem = { id: "n", kind: "note", title: "Aviso", plannedMinutes: 1 };
    const expected = expectationOf({ type: "program", itemId: "n" }, note);
    expect(isOnAir(expected, signal({ kind: "announcements" }))).toBe(true);
    expect(isOnAir(expected, signal({}))).toBe(false);
  });
});

describe("vídeo on-line", () => {
  const video = (videoId: string) => ({ type: "online", videoId, title: "Louvor" }) as const;

  it("é o mesmo Playable pelo ID do vídeo", () => {
    expect(samePlayable(video("dQw4w9WgXcQ"), video("dQw4w9WgXcQ"))).toBe(true);
    expect(samePlayable(video("dQw4w9WgXcQ"), video("aaaaaaaaaaa"))).toBe(false);
  });

  it("está no ar pelo ID, embutido ou tocando como arquivo", () => {
    const expected = expectationOf(video("dQw4w9WgXcQ"), null);
    expect(isOnAir(expected, signal({ kind: "online_video", videoId: "dQw4w9WgXcQ" }))).toBe(true);
    expect(isOnAir(expected, signal({ kind: "file", videoId: "dQw4w9WgXcQ" }))).toBe(true);
    expect(isOnAir(expected, signal({ kind: "file", videoId: "aaaaaaaaaaa" }))).toBe(false);
    expect(isOnAir(expected, signal({ kind: "file" }))).toBe(false);
  });
});

describe("música personalizada", () => {
  const custom = (customId: string, title = "Minha Canção") =>
    ({ type: "song", id_music: -3, title, customId }) as const;

  it("é a mesma pelo UUID, não pelo número provisório da lista", () => {
    expect(samePlayable(custom("a"), custom("a"))).toBe(true);
    expect(samePlayable(custom("a"), custom("b"))).toBe(false);
    expect(samePlayable(custom("a"), { type: "song", id_music: -3, title: "x" })).toBe(false);
  });

  it("está no ar pelo UUID dos slides — título igual de outra música não engana", () => {
    const expected = expectationOf(custom("a"), null);
    expect(isOnAir(expected, signal({ kind: "music", customSongId: "a" }))).toBe(true);
    expect(isOnAir(expected, signal({ kind: "music", customSongId: "b" }))).toBe(false);
    expect(isOnAir(expected, signal({ kind: "music", songId: 7 }))).toBe(false);
    expect(isOnAir(expectationOf(custom("a"), null, "audio"), signal({ audio: true }))).toBe(true);
  });

  it("item do programa vindo da liturgia (id negativo + ref_id) espera a música pelo UUID", () => {
    const item: ProgramItem = {
      id: "c",
      kind: "music",
      title: "Minha Canção",
      plannedMinutes: 3,
      source: liturgyItem({ id: "s", tipo: LiturgyItemTypeEnum.MUSICA, subtipo: "sung", id_music: -2, ref_id: "uuid", item: "Minha Canção" }),
    };
    const expected = expectationOf({ type: "program", itemId: "c" }, item);
    expect(isOnAir(expected, signal({ kind: "music", customSongId: "uuid" }))).toBe(true);
  });
});

describe("filho de momento", () => {
  const momentItem: ProgramItem = {
    id: "m",
    kind: "moment",
    title: "Anúncios",
    plannedMinutes: 5,
    children: [
      { id: "a", title: "Batismo", kind: "image", path: "/Igreja/Anúncios/Batismo.jpg" },
      { id: "b", title: "Retiro", kind: "video", path: "/Igreja/Anúncios/Retiro.mp4" },
    ],
  };

  it("é o mesmo pelo item e pelo filho", () => {
    expect(samePlayable({ type: "child", itemId: "m", childId: "a" }, { type: "child", itemId: "m", childId: "a" })).toBe(true);
    expect(samePlayable({ type: "child", itemId: "m", childId: "a" }, { type: "child", itemId: "m", childId: "b" })).toBe(false);
  });

  it("arquivo do momento está no ar como arquivo", () => {
    const expected = expectationOf({ type: "child", itemId: "m", childId: "b" }, momentItem);
    expect(expected).toEqual({ kind: "file" });
    expect(isOnAir(expected, signal({ kind: "file" }))).toBe(true);
  });
});
