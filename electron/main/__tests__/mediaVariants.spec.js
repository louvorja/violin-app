// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { variantsOf } = require("../mediaVariants.js");

describe("variantsOf", () => {
  it("oferece o mp3 como alternativa ao opus", () => {
    expect(variantsOf("/files/musics/pt/Album/Song.opus")).toEqual([
      "/files/musics/pt/Album/Song.opus",
      "/files/musics/pt/Album/Song.mp3",
    ]);
  });

  it("oferece o opus como alternativa ao mp3", () => {
    expect(variantsOf("/files/Song.mp3")).toEqual(["/files/Song.mp3", "/files/Song.opus"]);
  });

  it("cobre jpg, jpeg e bmp para capas", () => {
    expect(variantsOf("/files/covers/1992.jpg")).toEqual([
      "/files/covers/1992.jpg",
      "/files/covers/1992.jpeg",
      "/files/covers/1992.bmp",
    ]);
  });

  it("mantém o caminho pedido à frente das alternativas", () => {
    expect(variantsOf("/files/covers/1992.bmp")[0]).toBe("/files/covers/1992.bmp");
  });

  it("reconhece a extensão independente de caixa", () => {
    expect(variantsOf("/files/Song.OPUS")).toEqual(["/files/Song.OPUS", "/files/Song.mp3"]);
  });

  it("devolve só o próprio caminho para extensões sem grupo", () => {
    expect(variantsOf("/files/leiame.txt")).toEqual(["/files/leiame.txt"]);
    expect(variantsOf("/files/sem-extensao")).toEqual(["/files/sem-extensao"]);
  });

  it("não confunde ponto no nome do diretório com extensão do arquivo", () => {
    expect(variantsOf("/files/Album 2.0/faixa.opus")).toEqual([
      "/files/Album 2.0/faixa.opus",
      "/files/Album 2.0/faixa.mp3",
    ]);
  });
});
