import { describe, expect, it } from "vitest";
import {
  PPT_ACCEPT,
  applyProgress,
  fontTone,
  hasRichContent,
  isFontFileName,
  parseFeatures,
  isPowerPointName,
  missingFonts,
  parseConvertResult,
  progressDetail,
} from "../pptxImport";

describe("pptxImport", () => {
  it("reconhece apresentações pela extensão", () => {
    expect(isPowerPointName("Culto.PPTX")).toBe(true);
    expect(isPowerPointName("louvor.ppsx")).toBe(true);
    expect(isPowerPointName("slides.pdf")).toBe(false);
    expect(isPowerPointName("pptx")).toBe(false);
    expect(isPowerPointName("")).toBe(false);
    expect(PPT_ACCEPT).toContain(".pptx");
  });

  it("aceita só resposta de sucesso com caminho de PDF", () => {
    const ok = parseConvertResult({
      ok: true,
      path: "C:/dados/pptx/a.pdf",
      fonts: [{ name: "Brich", status: "installed" }],
    });
    expect(ok.ok).toBe(true);
    const ruim = parseConvertResult({ ok: true, path: "C:/virus.exe" });
    expect(ruim.ok).toBe(false);
    const falha = parseConvertResult({
      ok: false,
      code: "no_converter",
      message: "Instale o LibreOffice",
    });
    expect(falha).toEqual({ ok: false, code: "no_converter", message: "Instale o LibreOffice" });
    expect(parseConvertResult(null).ok).toBe(false);
    const comFallback = parseConvertResult({
      ok: true,
      path: "/dados/pptx/a.pdf",
      permissionFallback: true,
    });
    expect(comFallback).toMatchObject({ ok: true, permissionFallback: true });
  });

  it("lista as fontes que continuam faltando", () => {
    expect(
      missingFonts([
        { name: "Arial", status: "ok", source: null },
        { name: "Bremlin", status: "missing", source: null },
        { name: "Bricolage", status: "unmatched", source: "google" },
        { name: "Brich", status: "installed", source: "embedded" },
      ])
    ).toEqual(["Bremlin", "Bricolage"]);
  });

  it("traduz o andamento para a lista de tarefas", () => {
    const tm = (k: string, n?: Record<string, unknown>) => `${k}${n ? JSON.stringify(n) : ""}`;
    expect(progressDetail({ path: "a", phase: "fonts" }, tm)?.progress).toBe(10);
    expect(
      progressDetail({ path: "a", phase: "converting", converter: "PowerPoint" }, tm)?.detail
    ).toContain("PowerPoint");
    expect(progressDetail({ path: "a", phase: "done" }, tm)).toBeNull();
  });
});

describe("pptxImport — janela de andamento", () => {
  const base = {
    name: "Culto.pptx",
    path: "C:/Culto.pptx",
    phase: "fonts" as const,
    converter: "",
    fonts: [],
    error: "",
  };

  it("acompanha fontes e etapas do arquivo certo", () => {
    let s = applyProgress(base, {
      path: "C:/Culto.pptx",
      phase: "font",
      name: "Brich",
      status: "searching",
    });
    expect(s.fonts).toEqual([{ name: "Brich", status: "searching", source: null }]);
    s = applyProgress(s, {
      path: "C:/Culto.pptx",
      phase: "font",
      name: "Brich",
      status: "installed",
      source: "embedded",
    });
    expect(s.fonts).toHaveLength(1);
    expect(s.fonts[0].status).toBe("installed");
    s = applyProgress(s, { path: "C:/Culto.pptx", phase: "converting", converter: "PowerPoint" });
    expect(s.phase).toBe("converting");
    expect(s.converter).toBe("PowerPoint");
    // evento de outro arquivo não mexe
    expect(applyProgress(s, { path: "C:/Outro.pptx", phase: "fonts" })).toBe(s);
  });

  it("dá cor à situação de cada fonte", () => {
    expect(fontTone("ok")).toBe("success");
    expect(fontTone("installed")).toBe("success");
    expect(fontTone("missing")).toBe("danger");
    expect(fontTone("unmatched")).toBe("warning");
    expect(fontTone("searching")).toBe("neutral");
  });
});

describe("pptxImport — lista inicial de fontes", () => {
  it("a fase de fontes já traz todas, classificadas", () => {
    const s = applyProgress(
      { name: "a", path: "p", phase: "fonts", converter: "", fonts: [], error: "" },
      {
        path: "p",
        phase: "fonts",
        fonts: [
          { name: "Arial", status: "ok", source: null },
          { name: "Brich", status: "missing", source: null },
        ],
      }
    );
    expect(s.fonts.map((f) => f.name)).toEqual(["Arial", "Brich"]);
  });
});

describe("pptxImport — arquivo de fonte arrastado", () => {
  it("aceita .ttf, .otf e o .zip do DaFont", () => {
    expect(isFontFileName("Komika.TTF")).toBe(true);
    expect(isFontFileName("fonte.otf")).toBe(true);
    expect(isFontFileName("komika_axis.zip")).toBe(true);
    expect(isFontFileName("slides.pptx")).toBe(false);
    expect(isFontFileName("")).toBe(false);
  });
});

describe("pptxImport — contagem dos slides", () => {
  it("guarda 'slide X de Y' e avança a tarefa em segundo plano", () => {
    const base = {
      name: "a",
      path: "p",
      phase: "fonts" as const,
      converter: "",
      fonts: [],
      error: "",
    };
    const s = applyProgress(base, {
      path: "p",
      phase: "converting",
      converter: "PowerPoint",
      done: 12,
      total: 40,
    });
    expect(s.slidesDone).toBe(12);
    expect(s.slidesTotal).toBe(40);
    const tm = (k: string, n?: Record<string, unknown>) => `${k}${n ? JSON.stringify(n) : ""}`;
    const info = progressDetail({ path: "p", phase: "converting", done: 40, total: 40 }, tm);
    expect(info?.progress).toBe(95);
    expect(info?.detail).toContain("converting_count");
  });
});

describe("pptxImport — animações e mídias", () => {
  it("valida o que vem do main e diz se há o que perder no modo imagem", () => {
    expect(parseFeatures({ animatedSlides: 7, videos: 2.9, audios: -1 })).toEqual({
      animatedSlides: 7,
      videos: 2,
      audios: 0,
    });
    expect(parseFeatures(null)).toEqual({ animatedSlides: 0, videos: 0, audios: 0 });
    expect(hasRichContent({ animatedSlides: 0, videos: 1, audios: 0 })).toBe(true);
    expect(hasRichContent({ animatedSlides: 0, videos: 0, audios: 0 })).toBe(false);
    expect(hasRichContent(null)).toBe(false);
  });
});
