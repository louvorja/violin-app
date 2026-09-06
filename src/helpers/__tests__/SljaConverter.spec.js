/**
 * SljaConverter.spec.js — Round-trip do formato .slja.
 *
 * Valida o ciclo completo usado pelos módulos editor/coletâneas/hinário:
 *   slides (schema CustomSlide) → writeSlja → loadSlja → slides importados
 * preservando nome ([Geral].nome), tempo de sincronia, imagem e formatação.
 */
import { describe, it, expect } from "vitest";
import SljaConverter from "@/helpers/SljaConverter";
import JSZipPkg from "jszip";

const JSZip = JSZipPkg.default?.default ?? JSZipPkg.default ?? JSZipPkg;

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function editorLikeSlides() {
  return [
    {
      tipo: "CAPA",
      letra: "Hino Teste",
      letra_aux: "",
      tamanho_letra: 18,
      tamanho_letra_aux: 10,
      cor_letra: "#efb400",
      cor_letra_aux: "#efb400",
      fundo_letra: true,
      cor_fundo: "#000000",
      imagem: "",
      imagem_posicao: 5,
      tempo_seconds: 0,
      text_align: "center",
    },
    {
      tipo: "LETRA",
      letra: "verso 1\nlinha 2",
      letra_aux: "refrão",
      tamanho_letra: 14,
      tamanho_letra_aux: 10,
      cor_letra: "#FFFFFF",
      cor_letra_aux: "#efb400",
      fundo_letra: false,
      cor_fundo: "#101010",
      imagem: "lib://image/abc123.png",
      imagem_posicao: 5,
      tempo_seconds: 12,
      text_align: "left",
    },
    {
      tipo: "LETRA",
      letra: "verso 2",
      letra_aux: "",
      tamanho_letra: 14,
      tamanho_letra_aux: 10,
      cor_letra: "#FFFFFF",
      cor_letra_aux: "#efb400",
      fundo_letra: true,
      cor_fundo: "#101010",
      imagem: "lib://image/abc123.png",
      imagem_posicao: 5,
      tempo_seconds: 9,
      text_align: "center",
    },
  ];
}

/** Replica o mapeamento de imagens do buildExportSlja/exportSong. */
async function exportPackage(slides) {
  const slidesForExport = [];
  const imagesMap = new Map();
  for (const s of slides) {
    const exp = { ...s };
    if (s.imagem) {
      const baseName = `${s.imagem
        .replace(/^.*\//, "")
        .replace(/\.[^.]+$/, "")}.${("image/png".split("/")[1] || "png").replace("jpeg", "jpg")}`;
      const path = `imagens/${baseName}`;
      if (!imagesMap.has(path)) imagesMap.set(path, new Blob(pngBytes));
      exp.imagem = path;
    }
    slidesForExport.push(exp);
  }
  return SljaConverter.writeSlja({
    slides: slidesForExport,
    audio: null,
    audioName: "audio.mp3",
    images: imagesMap,
    nome: "Hino Teste",
  });
}

describe("SljaConverter — round trip export/import", () => {
  it("preserva nome da música, tempo de sincronia, imagem e formatação", async () => {
    const blob = await exportPackage(editorLikeSlides());
    expect(blob.size).toBeGreaterThan(0);

    const data = await SljaConverter.loadSlja(blob);

    // Nome gravado em [Geral].nome
    expect(data.meta.nome).toBe("Hino Teste");

    // Tempo de sincronia preservado slide a slide
    expect(data.slides.map((s) => s.tempo_seconds)).toEqual([0, 12, 9]);

    // Imagens presentes no pacote e referenciadas pelos slides
    const keys = [...data.images.keys()];
    expect(keys.length).toBe(1);
    for (const s of data.slides) {
      if (!s.imagem) continue;
      const base = s.imagem.split(/[\\/]/).pop();
      expect(keys).toContain(base);
    }

    // Formatação preservada
    expect(data.slides[0].tipo).toBe("CAPA");
    expect(data.slides[0].letra).toBe("Hino Teste");
    expect(data.slides[1].letra.replace(/\|/g, "\n")).toBe("verso 1\nlinha 2");
    expect(data.slides[1].letra_aux).toBe("refrão");
    expect(data.slides[1].fundo_letra).toBe(false);
    expect(data.slides[1].cor_fundo).toBe("#101010");
    expect(data.slides[1].cor_letra).toBe("#FFFFFF");
    expect(data.slides[1].tamanho_letra).toBe(14);
    expect(data.slides[1].text_align).toBe("left");
  });

  it("lookup por basename encontra o token quando o INI usa caminho com pasta", async () => {
    const blob = await exportPackage(editorLikeSlides());
    const data = await SljaConverter.loadSlja(blob);

    // Replica o mapa duplo do onLoadSlja/importSljaFile
    const byName = new Map();
    for (const [path] of data.images.entries()) {
      const name = path.replace(/^(imagens|images)\//, "");
      byName.set(name, `pkg://image/${name}`);
      byName.set(path, `pkg://image/${name}`);
    }

    for (const s of data.slides) {
      if (!s.imagem) continue;
      const base = s.imagem.split(/[\\/]/).pop();
      expect(byName.get(s.imagem) || byName.get(base)).toBeTruthy();
    }
  });

  it("INI sem tempos (legado/hinário) importa com tempo_seconds zerado", async () => {
    const hymnalSlides = [
      { tipo: "CAPA", letra: "Hino Antigo", imagem: "img.jpg" },
      { tipo: "LETRA", letra: "estrofe", imagem: "img.jpg" },
    ];
    const blob = await SljaConverter.writeSlja({
      slides: hymnalSlides,
      audio: null,
      audioName: "hino.mp3",
      images: new Map([["img.jpg", new Blob(pngBytes)]]),
      nome: "Hino Antigo",
    });
    const data = await SljaConverter.loadSlja(blob);
    expect(data.meta.nome).toBe("Hino Antigo");
    expect(data.slides.every((s) => !s.tempo_seconds)).toBe(true);
  });

  it("aceita zips do Delphi com separador \\ nas pastas imagens/ e audio/", async () => {
    const ini = [
      "[Geral]",
      "slides=2",
      "nome=Hino Delphi",
      "",
      "[Slide:1]",
      "tipo=CAPA",
      "letra=Hino Delphi",
      "imagem=imagens\\foto.png",
      "",
      "[Slide:2]",
      "tipo=LETRA",
      "letra=estrofe",
      "tempo_hms=00:00:30",
      "imagem=imagens\\foto.png",
    ].join("\r\n");

    const zip = new JSZip();
    zip.file("slides.lja", ini);
    zip.file("imagens\\foto.png", pngBytes);
    zip.file("audio\\hino.mp3", new Uint8Array([1, 2, 3]));
    const blob = await zip.generateAsync({ type: "blob" });

    const data = await SljaConverter.loadSlja(blob);

    // Imagens encontradas apesar da barra invertida (chave = basename)
    expect([...data.images.keys()]).toEqual(["foto.png"]);
    expect(data.audioName).toBe("hino.mp3");
    expect(data.audio).not.toBeNull();

    // Lookup do import resolve caminho com \ via basename
    for (const s of data.slides) {
      const base = s.imagem.split(/[\\/]/).pop();
      expect(data.images.get(base)).toBeTruthy();
    }

    // Tempo vindo do INI Delphi
    expect(data.slides[1].tempo_seconds).toBe(30);
  });
});

describe("SljaConverter — compatibilidade com o Delphi", () => {
  /** Lê o slides.lja como o TIniFile do Delphi leria: bytes ANSI, sem BOM. */
  async function readIniAsDelphi(blob) {
    const zip = await JSZip.loadAsync(blob);
    const bytes = await zip.file("slides.lja").async("uint8array");
    return new TextDecoder("windows-1252").decode(bytes);
  }

  it("grava o INI em CP1252, e não em UTF-8", async () => {
    const blob = await SljaConverter.writeSlja({
      slides: [
        { tipo: "CAPA", letra: "Casa de Benção" },
        { tipo: "LETRA", letra: "Minha casa será um pedaço do céu" },
      ],
      nome: "Casa de Benção",
    });

    const ini = await readIniAsDelphi(blob);
    expect(ini).toContain("nome=Casa de Benção");
    expect(ini).toContain("letra=Minha casa será um pedaço do céu");
    expect(ini).not.toContain("BenÃ§Ã£o");
  });

  it("a tabela CP1252 fecha com o decodificador nos 256 bytes", () => {
    const allBytes = new Uint8Array(256).map((_, i) => i);
    const text = new TextDecoder("windows-1252").decode(allBytes);
    expect([...SljaConverter.encodeCp1252(text)]).toEqual([...allBytes]);
  });

  it("o que não cabe no CP1252 perde o acento, não o texto", () => {
    const bytes = SljaConverter.encodeCp1252("Kraḍa — “aspas” 😀");
    expect(new TextDecoder("windows-1252").decode(bytes)).toBe("Krada — “aspas” ?");
  });

  it("grava tempo em bytes do stream BASS, na taxa do MP3 do pacote", async () => {
    // Header MPEG2 Layer III, 22050 Hz, mono → 22050 × 1 × 2 = 44100 bytes/s
    const mp3 = new Blob([new Uint8Array([0xff, 0xf3, 0x90, 0xc0, ...new Array(60).fill(0)])]);
    expect(await SljaConverter.audioBytesPerSecond(mp3)).toBe(44100);

    const blob = await SljaConverter.writeSlja({
      slides: [
        { tipo: "CAPA", letra: "Hino", tempo_seconds: 0 },
        { tipo: "LETRA", letra: "estrofe", tempo_seconds: 12 },
      ],
      audio: mp3,
      audioName: "hino.mp3",
    });

    const ini = await readIniAsDelphi(blob);
    expect(ini).toContain("tempo=529200"); // 12s × 44100
    expect(ini).toContain("tempo_hms=00:00:12");

    // O nosso lado continua lendo segundos, via tempo_hms
    const data = await SljaConverter.loadSlja(blob);
    expect(data.slides.map((s) => s.tempo_seconds)).toEqual([0, 12]);
  });

  it("INI do Delphi sem tempo_hms tem o tempo lido como bytes, não segundos", async () => {
    const ini = [
      "[Geral]",
      "slides=1",
      "url_musica=audio\\hino.mp3",
      "",
      "[Slide:1]",
      "tipo=LETRA",
      "letra=estrofe",
      "tempo=5292000", // 30s a 44100 Hz estéreo
    ].join("\r\n");

    const zip = new JSZip();
    zip.file("slides.lja", ini);
    zip.file("audio\\hino.mp3", new Uint8Array([1, 2, 3]));

    const data = await SljaConverter.loadSlja(await zip.generateAsync({ type: "blob" }));
    expect(data.slides[0].tempo_seconds).toBe(30);
  });
});

describe("SljaConverter — resolveSongName", () => {
  it("[Geral].nome tem prioridade sobre o primeiro slide e o arquivo", () => {
    const data = {
      meta: { nome: "Nome do INI" },
      slides: [{ tipo: "CAPA", letra: "Capa Nome" }],
    };
    expect(SljaConverter.resolveSongName(data, "arquivo.slja")).toBe("Nome do INI");
  });

  it("sem nome no INI, usa a letra do primeiro slide (capa), colapsando quebras", () => {
    const data = {
      meta: {},
      slides: [
        { tipo: "CAPA", letra: "Hino\n  1996" },
        { tipo: "LETRA", letra: "estrofe" },
      ],
    };
    expect(SljaConverter.resolveSongName(data, "arquivo.slja")).toBe("Hino 1996");
  });

  it("sem INI e sem slides, usa o nome do arquivo sem extensão", () => {
    expect(SljaConverter.resolveSongName({ meta: {}, slides: [] }, "Hino X.slja")).toBe("Hino X");
    expect(SljaConverter.resolveSongName({}, "")).toBe("");
  });
});

describe("SljaConverter — fillMissingImages", () => {
  it("capa sem imagem herda a do próximo slide que a tenha", () => {
    const slides = [
      { imagem: "", imagem_posicao: 5 },
      { imagem: "imagens/a.png", imagem_posicao: 3 },
    ];
    SljaConverter.fillMissingImages(slides);
    expect(slides[0].imagem).toBe("imagens/a.png");
    expect(slides[1].imagem).toBe("imagens/a.png");
  });

  it("preserva a imagem_posicao original de cada slide preenchido", () => {
    const slides = [
      { imagem: "", imagem_posicao: 2 },
      { imagem: "imagens/a.png", imagem_posicao: 7 },
    ];
    SljaConverter.fillMissingImages(slides);
    expect(slides[0].imagem).toBe("imagens/a.png");
    expect(slides[0].imagem_posicao).toBe(2);
  });

  it("slides posteriores à primeira imagem permanecem sem imagem", () => {
    const slides = [
      { imagem: "" },
      { imagem: "imagens/a.png" },
      { imagem: "" },
      { imagem: "imagens/b.png" },
      { imagem: "" },
    ];
    SljaConverter.fillMissingImages(slides);
    expect(slides[0].imagem).toBe("imagens/a.png");
    expect(slides[1].imagem).toBe("imagens/a.png");
    expect(slides[2].imagem).toBe("");
    expect(slides[3].imagem).toBe("imagens/b.png");
    expect(slides[4].imagem).toBe("");
  });

  it("pacote todo sem imagem (ou com capa já preenchida) não altera nada", () => {
    const allEmpty = [{ imagem: "" }, { imagem: "" }];
    SljaConverter.fillMissingImages(allEmpty);
    expect(allEmpty.every((s) => s.imagem === "")).toBe(true);

    const capaFilled = [{ imagem: "imagens/x.png" }, { imagem: "" }];
    SljaConverter.fillMissingImages(capaFilled);
    expect(capaFilled[0].imagem).toBe("imagens/x.png");
    expect(capaFilled[1].imagem).toBe("");
  });
});
