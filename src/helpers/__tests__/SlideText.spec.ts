import { describe, expect, it } from "vitest";
import { slideMainText } from "../SlideText";

describe("slideMainText", () => {
  it("usa a letra quando existe", () => {
    expect(slideMainText({ lyric: "Castelo forte", name: "Hino 73", cover: false })).toBe("Castelo forte");
  });

  it("slide em branco do .slja fica em branco, sem o título nem o item da liturgia (#15)", () => {
    expect(slideMainText({ lyric: "", name: "Minha música", cover: false })).toBe("");
    expect(slideMainText({ lyric: "", name: "TESTE" })).toBe("");
  });

  it("a capa sem letra mostra o nome", () => {
    expect(slideMainText({ lyric: "", name: "Minha música", cover: true })).toBe("Minha música");
  });

  it("aceita slide ausente ou com campos de outro tipo", () => {
    expect(slideMainText(null)).toBe("");
    expect(slideMainText(undefined)).toBe("");
    expect(slideMainText({ lyric: 3, name: 4, cover: true })).toBe("");
  });
});
