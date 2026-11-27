import { describe, expect, it } from "vitest";
import { chosenMusicItem } from "../chosenMusic";
import type { LiturgyItem } from "@/types/Liturgy";
import type { SearchMusicItem } from "@/types/Music";

const item = { id: "i1", tipo: "musica", musica: -1, escolha: true } as unknown as LiturgyItem;
const musica = (dados: Record<string, unknown>) => dados as unknown as SearchMusicItem;

describe("chosenMusicItem", () => {
  it("música personalizada leva o UUID que o playMusic usa", () => {
    expect(
      chosenMusicItem(item, musica({ id_music: -3, name: "Local", custom_song_id: "uuid-1" }))
    ).toMatchObject({ id: "i1", id_music: -3, musica: -3, escolha: false, ref_id: "uuid-1" });
  });

  it("música do acervo apaga o UUID que o item trazia", () => {
    const comSobra = { ...item, ref_id: "uuid-antigo" } as LiturgyItem;
    const pronto = chosenMusicItem(comSobra, musica({ id_music: "12", name: "Hino" }));
    expect(pronto).toMatchObject({ id_music: 12, musica: 12, escolha: false });
    expect(pronto?.ref_id).toBeUndefined();
  });

  it("recusa o que não tem como tocar", () => {
    expect(chosenMusicItem(item, musica({ id_music: "abc", name: "x" }))).toBeNull();
    expect(chosenMusicItem(item, musica({ id_music: -2, name: "sem uuid" }))).toBeNull();
  });
});
