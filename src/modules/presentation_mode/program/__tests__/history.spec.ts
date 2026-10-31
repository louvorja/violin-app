import { describe, expect, it } from "vitest";
import { historyItem, recordEntry, type HistoryEntry } from "../history";
import { canvaDesignOf } from "../items";
import type { Playable } from "../playable";

const file = (path: string): Playable => ({
  type: "file",
  entry: { name: path.split("/").pop()!, path, ext: "png", isDir: false } as never,
});
const entry = (id: string, playable: Playable): HistoryEntry => ({ id, at: 0, playable });

describe("history", () => {
  it("anota na ordem e não repete o que já está por último", () => {
    let list = recordEntry([], entry("1", file("/igreja/a.png")));
    list = recordEntry(list, entry("2", file("/igreja/a.png")));
    list = recordEntry(list, entry("3", file("/igreja/b.png")));
    list = recordEntry(list, entry("4", file("/igreja/a.png")));
    expect(list.map((e) => e.id)).toEqual(["1", "3", "4"]);
  });

  it("o que é do programa não entra: a coluna já é o programa", () => {
    expect(recordEntry([], entry("1", { type: "program", itemId: "x" }))).toEqual([]);
  });

  it("vira item do programa com o tipo certo", () => {
    expect(historyItem(entry("1", file("/igreja/a.png")))?.kind).toBe("image");
    const song = historyItem({
      ...entry("2", { type: "song", id_music: 7, title: "Hino", subtitle: "Coletânea" }),
      mode: "pb",
    });
    expect(song?.kind).toBe("music");
    expect(song?.title).toBe("Hino");
    const sung = historyItem(entry("4", { type: "song", id_music: 8, title: "Outro" }));
    expect((sung?.source as { subtipo?: string } | undefined)?.subtipo).toBe("sung");
    expect(historyItem(entry("3", { type: "online", videoId: "abc", title: "Vídeo" }))?.kind).toBe(
      "online_video"
    );
  });
});

describe("design do Canva no navegador", () => {
  const canva: Playable = { type: "canva", designId: "DAF1", title: "Avisos", thumb: null };

  it("entra no histórico e volta ao programa como site que lembra o design", () => {
    expect(recordEntry([], entry("1", canva))).toHaveLength(1);
    const item = historyItem(entry("1", canva));
    expect(item?.kind).toBe("site");
    expect(item && canvaDesignOf(item)).toBe("DAF1");
  });
});
