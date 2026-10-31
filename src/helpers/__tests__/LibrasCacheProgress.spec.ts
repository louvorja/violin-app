/**
 * LibrasCacheProgress — completude da Libras não pode ser inferida por
 * "existe alguma entrada". Slides e versículos gravam entradas próprias e
 * faziam álbuns/versões incompletos parecerem prontos.
 */
import { describe, it, expect } from "vitest";
import { progressoDeCache, musicCacheCompletos, bibleChaptersCompletos } from "@/helpers/Libras";
import type { LibrasCacheEntry } from "@/types/Libras";

function entry(parcial: Partial<LibrasCacheEntry>): LibrasCacheEntry {
  return {
    id: "",
    type: "music",
    ref_id: "",
    lang: "pt",
    original_text: "",
    gloss: "",
    tokens: [],
    bundles_cached: true,
    bundles_size: 0,
    created_at: "",
    updated_at: "",
    ...parcial,
  };
}

describe("progressoDeCache", () => {
  it("classifica vazio, parcial e completo", () => {
    expect(progressoDeCache(0, 10)).toMatchObject({ have: 0, partial: false, complete: false });
    expect(progressoDeCache(4, 10)).toMatchObject({ have: 4, partial: true, complete: false });
    expect(progressoDeCache(10, 10)).toMatchObject({ have: 10, partial: false, complete: true });
  });

  it("protege contra total zero e valores fora da faixa", () => {
    expect(progressoDeCache(0, 0).complete).toBe(false);
    expect(progressoDeCache(99, 10)).toMatchObject({ have: 10, complete: true });
    expect(progressoDeCache(-3, 10)).toMatchObject({ have: 0, partial: false });
  });
});

describe("musicCacheCompletos", () => {
  it("conta só a tradução principal com bundles", () => {
    const entries = [
      entry({ id: "music_10_default", ref_id: "10" }),
      entry({ id: "music_20_default", ref_id: "20", bundles_cached: false }),
      entry({ id: "music_30_default", ref_id: "30" }),
    ];
    expect(musicCacheCompletos(entries)).toEqual(new Set([10, 30]));
  });

  it("ignora os slides da mesma música", () => {
    const entries = [
      entry({ id: "music_10_default", ref_id: "10" }),
      entry({ id: "music_slide_10_0_default", ref_id: "10" }),
      entry({ id: "music_slide_11_0_default", ref_id: "11" }),
    ];
    expect(musicCacheCompletos(entries)).toEqual(new Set([10]));
  });

  it("respeita a região", () => {
    const entries = [
      entry({ id: "music_10_default", ref_id: "10" }),
      entry({ id: "music_10_sudeste", ref_id: "10" }),
    ];
    expect(musicCacheCompletos(entries, "sudeste")).toEqual(new Set([10]));
    expect(musicCacheCompletos(entries, "nordeste")).toEqual(new Set());
  });
});

describe("bibleChaptersCompletos", () => {
  const versoes = new Map([
    ["GN", 1],
    ["EX", 2],
  ]);

  it("conta a entrada do capítulo e ignora os versículos", () => {
    const entries = [
      entry({ id: "bible_GN_1_1_default", ref_id: "GN_1_1", type: "bible" }),
      entry({ id: "bible_GN_1_1_1_default", ref_id: "GN_1_1_1", type: "bible" }),
      entry({ id: "bible_GN_1_2_default", ref_id: "GN_1_2", type: "bible" }),
    ];
    const mapa = bibleChaptersCompletos(entries, versoes);
    expect([...mapa.get(1)!]).toEqual(["1_1", "1_2"]);
  });

  it("ignora capítulo sem bundles e de região diferente", () => {
    const entries = [
      entry({
        id: "bible_GN_1_1_default",
        ref_id: "GN_1_1",
        type: "bible",
        bundles_cached: false,
      }),
      entry({ id: "bible_EX_1_1_sudeste", ref_id: "EX_1_1", type: "bible" }),
    ];
    expect(bibleChaptersCompletos(entries, versoes).size).toBe(0);
    expect(bibleChaptersCompletos(entries, versoes, "sudeste").get(2)).toEqual(new Set(["1_1"]));
  });
});
