// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * Núcleo do "PowerPoint fiel": descobrir quais fontes o .pptx pede, sem abrir
 * o PowerPoint, e comparar com as fontes instaladas pelo nome normalizado.
 */
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const JSZip = require("jszip");
const { norm, splitStyle, buildInstalledIndex, isInstalled, isOfficeCloud } = require("../pptx/fontNames.js");
const { readPptxFonts } = require("../pptx/pptxFonts.js");
const { renameFont } = require("../pptx/fontRename.js");
const { SCRIPT } = require("../pptx/windowsScript.js");
const { MAC_SCRIPT } = require("../pptx/converters.js");

async function pptxCom(arquivos) {
  const zip = new JSZip();
  for (const [nome, xml] of Object.entries(arquivos)) zip.file(nome, xml);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lj-pptx-"));
  const file = path.join(dir, "teste.pptx");
  await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
  return { file, dir };
}

describe("fontNames", () => {
  it("normaliza espaços, hífens, acentos e o sufixo do registro", () => {
    expect(norm("Montserrat-Black")).toBe("montserratblack");
    expect(norm("Montserrat Black (TrueType)")).toBe("montserratblack");
    expect(norm("Fonte Câmbio")).toBe("fontecambio");
  });

  it("separa a família do estilo, inclusive estilo de duas palavras", () => {
    expect(splitStyle("Montserrat ExtraBold Italic")).toEqual({ base: "Montserrat", styles: ["extrabold", "italic"] });
    expect(splitStyle("Open Sans Semi Bold")).toEqual({ base: "Open Sans", styles: ["semibold"] });
  });

  it("só conta fonte cujo arquivo ainda existe", () => {
    const idx = buildInstalledIndex({
      entries: [
        { name: "Bremlin (TrueType)", exists: false },
        { name: "Arial Bold (TrueType)", exists: true },
      ],
    });
    expect(isInstalled(idx, "Bremlin")).toBe(false);
    expect(isInstalled(idx, "Arial")).toBe(true);
  });

  it("peso pesado instalado não implica a família regular", () => {
    const idx = buildInstalledIndex({ entries: [{ name: "Montserrat Black (TrueType)", exists: true }] });
    expect(isInstalled(idx, "Montserrat Black")).toBe(true);
    expect(isInstalled(idx, "Montserrat")).toBe(false);
  });

  it("reconhece as fontes de nuvem do Office", () => {
    expect(isOfficeCloud("Aptos Display")).toBe(true);
    expect(isOfficeCloud("Montserrat")).toBe(false);
  });
});

describe("readPptxFonts", () => {
  it("lê as fontes dos slides e do tema, e as embutidas", async () => {
    const { file, dir } = await pptxCom({
      "ppt/slides/slide1.xml": '<p:sld><a:latin typeface="Bricolage Grotesque ExtraBold"/><a:latin typeface="+mj-lt"/></p:sld>',
      "ppt/theme/theme1.xml": '<a:theme><a:latin typeface="Calibri"/><a:sym typeface="Wingdings"/></a:theme>',
      "ppt/presentation.xml":
        '<p:presentation><p:embeddedFontLst><p:embeddedFont><p:font typeface="Brich"/></p:embeddedFont></p:embeddedFontLst></p:presentation>',
    });
    try {
      const r = await readPptxFonts(file);
      expect(r.fonts).toEqual(["Bricolage Grotesque ExtraBold", "Calibri", "Wingdings"]);
      expect(r.embedded).toEqual(["Brich"]);
    } finally {
      await fs.remove(dir);
    }
  });
});

describe("fontRename", () => {
  it("recusa arquivo que não é fonte", () => {
    expect(() => renameFont(Buffer.from("não é fonte"), { family: "X", weight: 800, italic: false })).toThrow();
  });
});

describe("scripts embutidos", () => {
  it("o script do PowerShell não tem crase e exporta os slides como imagem", () => {
    expect(SCRIPT.includes("`")).toBe(false);
    expect(SCRIPT).toContain(".Export(");
  });

  it("o AppleScript exporta os slides como imagem e fecha sem salvar o original", () => {
    expect(MAC_SCRIPT).toContain("save as PNG");
    expect(MAC_SCRIPT).toContain("saving no");
  });
});

describe("imagesToPdf", () => {
  // JPEG 4x3 vermelho
  const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z", "base64");

  it("lê largura, altura e cor do JPEG", () => {
    const { jpegInfo } = require("../pptx/imagesPdf.js");
    expect(jpegInfo(JPG)).toEqual({ width: 4, height: 3, components: 3 });
    expect(jpegInfo(Buffer.from("não é jpeg"))).toBeNull();
  });

  it("monta uma página por imagem, no tamanho do slide, e pula o que não é imagem", async () => {
    const { imagesToPdf } = require("../pptx/imagesPdf.js");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lj-pptx-img-"));
    try {
      const a = path.join(dir, "slide_0001.jpg");
      const b = path.join(dir, "slide_0002.jpg");
      const lixo = path.join(dir, "lixo.png");
      await fs.writeFile(a, JPG);
      await fs.writeFile(b, JPG);
      await fs.writeFile(lixo, "não é imagem");
      const out = path.join(dir, "saida.pdf");
      expect(await imagesToPdf([a, lixo, b], out, { width: 960, height: 540 })).toBe(2);
      const pdf = (await fs.readFile(out)).toString("latin1");
      expect(pdf.startsWith("%PDF-1.4")).toBe(true);
      expect(pdf).toContain("/Count 2");
      expect(pdf).toContain("/MediaBox [0 0 960 540]");
      expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
      // a tabela xref aponta para o começo de cada objeto
      const xref = Number(/startxref\n(\d+)/.exec(pdf)[1]);
      const linhas = pdf.slice(xref).split("\n").slice(3, 9);
      linhas.forEach((l, i) => expect(pdf.slice(Number(l.slice(0, 10)))).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    } finally {
      await fs.remove(dir);
    }
  });
});

describe("installFontFiles — validação da fronteira", () => {
  it("recusa o que não é fonte nem zip, e caminho que não existe", async () => {
    const Module = require("node:module");
    const original = Module._load;
    Module._load = function (req, ...rest) {
      if (req === "electron") return { app: { getPath: () => os.tmpdir() } };
      return original.call(this, req, ...rest);
    };
    try {
      delete require.cache[require.resolve("../pptx/index.js")];
      const pptx = require("../pptx/index.js");
      const r = await pptx.installFontFiles(["/etc/passwd", "/nao/existe.zip", 42, null]);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("no_fonts");
      expect((await pptx.installFontFiles("não é lista")).ok).toBe(false);
    } finally {
      Module._load = original;
    }
  });
});

describe("readPptxFeatures", () => {
  it("conta slides animados e mídias de vídeo e áudio", async () => {
    const { readPptxFeatures } = require("../pptx/pptxFonts.js");
    const { file, dir } = await pptxCom({
      "ppt/slides/slide1.xml": '<p:sld><p:timing><p:cTn presetClass="entr"/></p:timing></p:sld>',
      "ppt/slides/slide2.xml": "<p:sld/>",
      "ppt/slides/slide3.xml": '<p:sld><p:cTn presetClass="emph"/></p:sld>',
      "ppt/media/media1.mp4": "x",
      "ppt/media/media2.m4a": "x",
      "ppt/media/image1.png": "x",
    });
    try {
      expect(await readPptxFeatures(file)).toEqual({ animatedSlides: 2, videos: 1, audios: 1 });
    } finally {
      await fs.remove(dir);
    }
  });
});

describe("nativeShow", () => {
  it("o script do modo nativo não tem crase e posiciona no monitor do PA", () => {
    const { SCRIPT } = require("../pptx/nativeShow.js");
    expect(SCRIPT.includes("`")).toBe(false);
    expect(SCRIPT).toContain("SlideShowSettings");
    expect(SCRIPT).toContain("GotoSlide");
  });
});
