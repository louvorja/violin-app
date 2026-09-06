import { describe, it, expect } from "vitest";
import { shouldShowReleaseNotes } from "../ReleaseNotesPolicy";

describe("shouldShowReleaseNotes", () => {
  it("não mostra na instalação nova — não houve atualização nenhuma", () => {
    expect(
      shouldShowReleaseNotes({
        previousVersion: null,
        seenVersion: null,
        currentVersion: "2.0.0",
      })
    ).toBe(false);
  });

  it("mostra depois de atualizar", () => {
    expect(
      shouldShowReleaseNotes({
        previousVersion: "2.0.0",
        seenVersion: null,
        currentVersion: "2.1.0",
      })
    ).toBe(true);
  });

  it("não repete no boot seguinte, já com as notas fechadas", () => {
    expect(
      shouldShowReleaseNotes({
        previousVersion: "2.1.0",
        seenVersion: "2.1.0",
        currentVersion: "2.1.0",
      })
    ).toBe(false);
  });

  it("não mostra quando a versão não mudou, mesmo sem nunca ter visto as notas", () => {
    expect(
      shouldShowReleaseNotes({
        previousVersion: "2.1.0",
        seenVersion: null,
        currentVersion: "2.1.0",
      })
    ).toBe(false);
  });

  it("volta a mostrar quem fechou o app antes de ver as notas da versão atual", () => {
    expect(
      shouldShowReleaseNotes({
        previousVersion: "2.0.0",
        seenVersion: "1.9.0",
        currentVersion: "2.1.0",
      })
    ).toBe(true);
  });

  it("mostra também em downgrade — a versão mudou e as notas são outras", () => {
    expect(
      shouldShowReleaseNotes({
        previousVersion: "2.2.0",
        seenVersion: null,
        currentVersion: "2.1.0",
      })
    ).toBe(true);
  });
});
