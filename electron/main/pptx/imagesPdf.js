"use strict";

/**
 * imagesPdf — monta um PDF com uma imagem por página (os slides exportados).
 *
 * Cada página tem o tamanho do slide (em pontos) e a imagem ocupa a página
 * inteira. Sem texto nem fonte: o pdf.js da projeção só desenha a figura, e o
 * resultado é o pixel que o PowerPoint gerou.
 *
 * O PDF é escrito à mão (JPEG embutido como DCTDecode): é o caso mais simples
 * do formato e não justifica uma dependência nova.
 */
const fs = require("fs/promises");

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPG_MAGIC = [0xff, 0xd8, 0xff];

const _comeca = (buf, magic) => magic.every((b, i) => buf[i] === b);

/**
 * PNG → JPEG (qualidade 92) pelo `nativeImage` do Electron. Slide com foto em
 * PNG passa de 3 MB; em JPEG fica perto de 400 KB, sem diferença visível no
 * telão. Fora do Electron (testes em Node puro) não há conversor: devolve null.
 */
function _pngParaJpeg(bytes) {
  try {
    const { nativeImage } = require("electron");
    if (!nativeImage?.createFromBuffer) return null;
    const img = nativeImage.createFromBuffer(bytes);
    if (img.isEmpty()) return null;
    return img.toJPEG(92);
  } catch {
    return null;
  }
}

/**
 * Largura, altura e componentes de cor de um JPEG (marcador SOF).
 * @returns {{width: number, height: number, components: number} | null}
 */
function jpegInfo(buf) {
  if (!_comeca(buf, JPG_MAGIC)) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const _num = (n) => (Math.round(n * 1000) / 1000).toString();

/**
 * Escreve o PDF. Cada item: JPEG + tamanho da página em pontos.
 * @param {{jpeg: Buffer, info: {width: number, height: number, components: number}, w: number, h: number}[]} paginas
 */
function _montarPdf(paginas) {
  const partes = [];
  const offsets = [];
  let tamanho = 0;
  const escreve = (b) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    partes.push(buf);
    tamanho += buf.length;
  };
  const objeto = (id, corpo, stream) => {
    offsets[id] = tamanho;
    escreve(`${id} 0 obj\n${corpo}\n`);
    if (stream) {
      escreve("stream\n");
      escreve(stream);
      escreve("\nendstream\n");
    }
    escreve("endobj\n");
  };

  escreve("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  // 1 = Catalog, 2 = Pages, depois 3 objetos por página (Page, Contents, Image)
  const kids = paginas.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2, `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`);
  paginas.forEach((p, i) => {
    const page = 3 + i * 3;
    const content = page + 1;
    const image = page + 2;
    const desenho = Buffer.from(`q ${_num(p.w)} 0 0 ${_num(p.h)} 0 0 cm /Im0 Do Q`, "latin1");
    const cor =
      p.info.components === 1
        ? "/DeviceGray"
        : p.info.components === 4
          ? "/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]"
          : "/DeviceRGB";
    objeto(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${_num(p.w)} ${_num(p.h)}] ` +
        `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`
    );
    objeto(content, `<< /Length ${desenho.length} >>`, desenho);
    objeto(
      image,
      `<< /Type /XObject /Subtype /Image /Width ${p.info.width} /Height ${p.info.height} ` +
        `/ColorSpace ${cor} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`,
      p.jpeg
    );
  });

  const total = 3 + paginas.length * 3;
  const xref = tamanho;
  let tabela = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) tabela += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  escreve(tabela);
  escreve(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(partes);
}

/**
 * @param {string[]} files  PNGs ou JPGs, na ordem dos slides
 * @param {string} output   caminho do PDF a gravar
 * @param {{width?: number, height?: number}} [slide]  tamanho do slide em pontos;
 *   sem ele, a página segue a proporção da imagem com 960 pt de largura
 * @returns {Promise<number>} páginas gravadas
 */
async function imagesToPdf(files, output, slide = {}) {
  const paginas = [];
  for (const file of files) {
    let bytes = await fs.readFile(file);
    if (_comeca(bytes, PNG_MAGIC)) bytes = _pngParaJpeg(bytes);
    const info = bytes && jpegInfo(bytes);
    if (!info || !info.width || !info.height) continue;
    let w = Number(slide.width);
    let h = Number(slide.height);
    if (!(w > 0 && h > 0)) {
      w = 960;
      h = (960 * info.height) / info.width;
    }
    paginas.push({ jpeg: bytes, info, w, h });
  }
  if (!paginas.length) throw new Error("Nenhuma imagem de slide válida.");
  await fs.writeFile(output, _montarPdf(paginas));
  return paginas.length;
}

module.exports = { imagesToPdf, jpegInfo };
