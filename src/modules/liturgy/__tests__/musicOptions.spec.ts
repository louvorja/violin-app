import { describe, expect, it } from "vitest";
import Strings from "@/helpers/Strings";
import type { LiturgyMusicItem } from "@/types/Liturgy";
import { buildMusicOptions, musicMatches } from "../musicOptions";

const hino = (id: number, name: string, track: number, album = "Hinário Adventista 1996") => ({
  id_music: id,
  name,
  albums_names: album,
  albums: [
    { id_album: 1, name: album, type: "hymnal", pivot: { id_music: id, id_album: 1, track } },
  ],
});

const CATALOGO: LiturgyMusicItem[] = [
  hino(1, "Pertenço a Cristo", 285),
  hino(2, "Santo, Santo, Santo!", 28),
  hino(3, "Grandioso És Tu", 12),
  hino(4, "Manhã de Glória", 128),
  // Faixa 285 de um CD comum: só o número de hinário conta como número de hino.
  {
    id_music: 5,
    name: "Abrigo na Rocha",
    albums_names: "Adoração Vol. 2",
    albums: [
      {
        id_album: 2,
        name: "Adoração Vol. 2",
        type: "album",
        pivot: { id_music: 5, id_album: 2, track: 285 },
      },
    ],
  },
  { id_music: 6, name: "Abrigo na Rocha", albums_names: "Louvores do Sul", albums: [] },
  { id_music: -1, name: "Minha canção", custom_song_id: "abc" },
];

const opcoes = buildMusicOptions(CATALOGO);

// O combobox entrega o termo já normalizado; o teste faz o mesmo.
const achar = (texto: string) =>
  opcoes.filter((o) => musicMatches(o, Strings.clean(texto))).map((o) => o.value);

describe("buildMusicOptions", () => {
  it("ordena por rótulo e marca a música personalizada com ♪", () => {
    const rotulos = opcoes.map((o) => o.label);
    expect(rotulos).toContain("♪ Minha canção");
    expect(rotulos).toEqual([...rotulos].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  it("guarda o nome do CD como texto secundário, vazio quando não há", () => {
    expect(opcoes.find((o) => o.value === 5)?.detail).toBe("Adoração Vol. 2");
    expect(opcoes.find((o) => o.value === -1)?.detail).toBe("");
  });
});

describe("musicMatches", () => {
  it("casa por trecho do título sem distinguir acento, caixa nem pontuação", () => {
    expect(achar("santo santo")).toEqual([2]);
    expect(achar("MANHA")).toEqual([4]);
  });

  it("casa pelo nome do CD", () => {
    expect(achar("louvores do sul")).toEqual([6]);
    expect(achar("hinario adventista")).toHaveLength(4);
  });

  it("casa o número do hino por igualdade, não por trecho", () => {
    expect(achar("285")).toEqual([1]);
    expect(achar("28")).toEqual([2]);
    expect(achar("12")).toEqual([3]);
  });

  it("ignora o número de faixa de um CD que não é hinário", () => {
    expect(achar("285")).not.toContain(5);
  });

  it("não casa o que não existe", () => {
    expect(achar("zzz")).toEqual([]);
    expect(achar("999")).toEqual([]);
  });

  it("mantém títulos iguais de CDs diferentes como opções separadas", () => {
    expect(achar("abrigo na rocha").sort()).toEqual([5, 6]);
  });
});
