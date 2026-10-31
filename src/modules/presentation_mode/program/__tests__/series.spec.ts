import { describe, expect, it } from "vitest";
import type { SeriesDoc } from "@/types/Series";
import { PlayedTime, playedInCycle, playedThreshold, progressOf, splitPath } from "../series";

const files = ["01 Água.mp4", "02 Sono.mp4", "03 Sol.mp4"];
const doc = (plays: SeriesDoc["plays"], cycle = 1): SeriesDoc => ({
  version: 1,
  active: true,
  name: "Momento Saúde",
  onEnd: "restart",
  cycle,
  settingsAt: "2026-09-01T00:00:00Z",
  plays,
});
const play = (id: string, file: string, cycle = 1, undone?: true) => ({
  id,
  file,
  at: `2026-09-1${id}T19:30:00Z`,
  cycle,
  ...(undone ? { undone } : {}),
});

describe("série", () => {
  it("o próximo é o primeiro da pasta que ainda não passou neste ciclo", () => {
    expect(progressOf(doc([]), files)).toEqual({ next: "01 Água.mp4", played: 0, total: 3, completed: false });
    const d = doc([play("1", "01 Água.mp4"), play("2", "03 Sol.mp4"), play("3", "02 Sono.mp4", 1, true)]);
    expect(progressOf(d, files)).toEqual({ next: "02 Sono.mp4", played: 2, total: 3, completed: false });
  });

  it("exibições de ciclos anteriores não contam", () => {
    const d = doc([play("1", "01 Água.mp4", 1)], 2);
    expect(playedInCycle(d).size).toBe(0);
    expect(progressOf(d, files).next).toBe("01 Água.mp4");
  });

  it("todos passaram: concluída", () => {
    const d = doc(files.map((f, i) => play(String(i + 1), f)));
    expect(progressOf(d, files)).toMatchObject({ next: null, completed: true });
  });

  it("separa pasta e arquivo no Windows e no macOS", () => {
    expect(splitPath("C:\\Igreja\\Saúde\\01.mp4")).toEqual({ dir: "C:\\Igreja\\Saúde", file: "01.mp4" });
    expect(splitPath("/Users/x/Saúde/01.mp4")).toEqual({ dir: "/Users/x/Saúde", file: "01.mp4" });
  });
});

describe("tempo tocado", () => {
  const playFor = (t: PlayedTime, path: string, from: number, to: number, duration = 60) => {
    let hit = false;
    for (let s = from; s <= to; s += 0.25) hit = t.feed(path, s, duration) || hit;
    return hit;
  };

  it("conta depois de 15 s tocando, uma vez só", () => {
    const t = new PlayedTime();
    expect(playFor(t, "a.mp4", 0, 14)).toBe(false);
    expect(playFor(t, "a.mp4", 14.25, 16)).toBe(true);
    expect(playFor(t, "a.mp4", 16.25, 30)).toBe(false);
  });

  it("a posição que sobrou do vídeo anterior não conta para o novo", () => {
    const t = new PlayedTime();
    playFor(t, "a.mp4", 0, 40);
    expect(t.feed("b.mp4", 40, 60)).toBe(false);
    expect(t.feed("b.mp4", 0, 60)).toBe(false);
    expect(playFor(t, "b.mp4", 0.25, 10)).toBe(false);
  });

  it("pular na barra e ficar pausado não somam", () => {
    const t = new PlayedTime();
    t.feed("a.mp4", 0, 60);
    expect(t.feed("a.mp4", 50, 60)).toBe(false);
    for (let i = 0; i < 100; i++) expect(t.feed("a.mp4", 50, 60)).toBe(false);
  });

  it("vídeo curto conta com 80% da duração", () => {
    expect(playedThreshold(10)).toBe(8);
    expect(playedThreshold(0)).toBe(15);
    const t = new PlayedTime();
    expect(playFor(t, "curto.mp4", 0, 8.5, 10)).toBe(true);
  });
});
