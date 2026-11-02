import { beforeEach, describe, expect, it } from "vitest";
import { useStage } from "../useStage";
import type { Playable } from "../../program/playable";

const foto: Playable = {
  type: "file",
  entry: {
    name: "familia.jpg",
    path: "/culto/familia.jpg",
    isDir: false,
    ext: "jpg",
    size: 1,
    mtimeMs: 0,
  },
};
const musica: Playable = {
  type: "file",
  entry: {
    name: "musica.mp3",
    path: "/culto/musica.mp3",
    isDir: false,
    ext: "mp3",
    size: 1,
    mtimeMs: 0,
  },
};

describe("useStage: duas camadas", () => {
  beforeEach(() => useStage().reset());

  it("a música por baixo não toma o lugar da foto como o que está no ar", () => {
    const stage = useStage();
    stage.markSent(foto, { kind: "file" });
    stage.markSent(musica, { kind: "audio" });
    expect(stage.sent.value?.playable).toStrictEqual(foto);
    expect(stage.sentAudio.value?.playable).toStrictEqual(musica);
  });

  it("parar só a música deixa a foto", () => {
    const stage = useStage();
    stage.markSent(foto, { kind: "file" });
    stage.markSent(musica, { kind: "audio" });
    stage.clearAudio();
    expect(stage.sent.value?.playable).toStrictEqual(foto);
    expect(stage.sentAudio.value).toBeNull();
  });
});
