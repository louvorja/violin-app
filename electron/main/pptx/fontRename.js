'use strict';
/**
 * Renomeia uma fonte por dentro (tabela "name") SEM mexer no desenho das letras.
 *
 * Por que: o Google Fonts entrega os pesos de fontes variáveis (ex.: Bricolage Grotesque 800)
 * com o nome interno genérico. O Windows instala, mas o PowerPoint procura a família
 * "Bricolage Grotesque ExtraBold" e não acha. Aqui gravamos os nomes no padrão do Windows:
 *
 *   400 → família "X"            estilo "Regular" / "Italic"
 *   700 → família "X"            estilo "Bold" / "Bold Italic"
 *   outros → família "X ExtraBold" estilo "Regular" / "Italic"   (+ família tipográfica "X")
 */

const WEIGHT_NAME = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black', 950: 'ExtraBlack' };

function namesFor(family, weight, italic) {
  weight = Number(weight) || 400;
  const wName = WEIGHT_NAME[weight] || String(weight);
  let fam, sub;
  if (weight === 400) { fam = family; sub = italic ? 'Italic' : 'Regular'; }
  else if (weight === 700) { fam = family; sub = italic ? 'Bold Italic' : 'Bold'; }
  else { fam = `${family} ${wName}`; sub = italic ? 'Italic' : 'Regular'; }
  const typoSub = weight === 400 ? (italic ? 'Italic' : 'Regular') : `${wName}${italic ? ' Italic' : ''}`;
  const full = `${family} ${typoSub}`.replace(/ Regular$/, '') || family;
  const ps = `${family.replace(/[^A-Za-z0-9]/g, '')}-${typoSub.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 63);
  return { 1: fam, 2: sub, 4: weight === 400 && !italic ? family : full, 6: ps, 16: family, 17: typoSub };
}

function checksum(buf) {
  let sum = 0;
  const padded = buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function buildNameTable(oldName, replace) {
  const records = [];
  // registros antigos que ficam (copyright, licença, etc.)
  if (oldName && oldName.length >= 6) {
    const count = oldName.readUInt16BE(2), strOff = oldName.readUInt16BE(4);
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 12;
      const r = {
        platformID: oldName.readUInt16BE(o), encodingID: oldName.readUInt16BE(o + 2),
        languageID: oldName.readUInt16BE(o + 4), nameID: oldName.readUInt16BE(o + 6),
      };
      const len = oldName.readUInt16BE(o + 8), off = oldName.readUInt16BE(o + 10);
      if (r.nameID in replace || r.nameID === 21 || r.nameID === 22 || r.nameID === 3) continue;
      if (r.languageID >= 0x8000) continue;             // tags de idioma (formato 1) — descarta
      r.data = oldName.subarray(strOff + off, strOff + off + len);
      records.push(r);
    }
  }
  const unique = `${replace[4]} SlideFlow`;
  const add = { ...replace, 3: unique };
  for (const [id, text] of Object.entries(add)) {
    if (!text) continue;
    // Windows (Unicode, inglês EUA)
    const utf16 = Buffer.from(text, 'utf16le');
    for (let i = 0; i < utf16.length; i += 2) { const t = utf16[i]; utf16[i] = utf16[i + 1]; utf16[i + 1] = t; } // → big-endian
    records.push({ platformID: 3, encodingID: 1, languageID: 0x0409, nameID: Number(id), data: utf16 });
    // Mac (Roman) — alguns programas antigos leem este
    if ([1, 2, 4, 6].includes(Number(id))) {
      records.push({ platformID: 1, encodingID: 0, languageID: 0, nameID: Number(id), data: Buffer.from(text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?'), 'latin1') });
    }
  }
  records.sort((a, b) => a.platformID - b.platformID || a.encodingID - b.encodingID || a.languageID - b.languageID || a.nameID - b.nameID);

  const header = Buffer.alloc(6 + records.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(records.length, 2);
  header.writeUInt16BE(6 + records.length * 12, 4);
  const strings = [];
  let off = 0;
  records.forEach((r, i) => {
    const o = 6 + i * 12;
    header.writeUInt16BE(r.platformID, o); header.writeUInt16BE(r.encodingID, o + 2);
    header.writeUInt16BE(r.languageID, o + 4); header.writeUInt16BE(r.nameID, o + 6);
    header.writeUInt16BE(r.data.length, o + 8); header.writeUInt16BE(off, o + 10);
    strings.push(r.data); off += r.data.length;
  });
  return Buffer.concat([header, ...strings]);
}

/** Recebe o arquivo .ttf/.otf (Buffer) e devolve um novo Buffer com os nomes trocados. */
function renameFont(buf, { family, weight = 400, italic = false }) {
  const sfnt = buf.readUInt32BE(0);
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(sfnt)) throw new Error('Formato de fonte não suportado');
  const numTables = buf.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.push({ tag: buf.toString('latin1', o, o + 4), offset: buf.readUInt32BE(o + 8), length: buf.readUInt32BE(o + 12) });
  }
  const get = t => buf.subarray(t.offset, t.offset + t.length);
  const nameT = tables.find(t => t.tag === 'name');
  const newName = buildNameTable(nameT ? get(nameT) : null, namesFor(family, weight, italic));
  if (!nameT) tables.push({ tag: 'name', offset: 0, length: 0 });

  const datas = tables.map(t => t.tag === 'name' ? newName : Buffer.from(get(t)));
  // head.checkSumAdjustment = 0 antes de calcular
  const headIdx = tables.findIndex(t => t.tag === 'head');
  if (headIdx >= 0) datas[headIdx].writeUInt32BE(0, 8);

  // estilo coerente com o nome: negrito/itálico só onde o Windows espera (400/700)
  const isBold = Number(weight) === 700;
  const os2Idx = tables.findIndex(t => t.tag === 'OS/2');
  if (os2Idx >= 0 && datas[os2Idx].length >= 64) {
    let fs = datas[os2Idx].readUInt16BE(62) & ~(1 | 32 | 64);
    if (italic) fs |= 1;
    if (isBold) fs |= 32;
    if (!italic && !isBold) fs |= 64;
    datas[os2Idx].writeUInt16BE(fs, 62);
  }
  if (headIdx >= 0 && datas[headIdx].length >= 46) {
    datas[headIdx].writeUInt16BE((datas[headIdx].readUInt16BE(44) & ~3) | (isBold ? 1 : 0) | (italic ? 2 : 0), 44);
  }

  const order = tables.map((t, i) => i).sort((a, b) => (tables[a].tag < tables[b].tag ? -1 : 1));
  const n = tables.length;
  const dirSize = 12 + n * 16;
  const header = Buffer.alloc(dirSize);
  header.writeUInt32BE(sfnt, 0);
  header.writeUInt16BE(n, 4);
  let p2 = 1, e = 0; while (p2 * 2 <= n) { p2 *= 2; e++; }
  header.writeUInt16BE(p2 * 16, 6); header.writeUInt16BE(e, 8); header.writeUInt16BE(n * 16 - p2 * 16, 10);

  const body = [];
  let offset = dirSize;
  order.forEach((idx, k) => {
    const d = datas[idx];
    const o = 12 + k * 16;
    header.write(tables[idx].tag, o, 4, 'latin1');
    header.writeUInt32BE(checksum(d), o + 4);
    header.writeUInt32BE(offset, o + 8);
    header.writeUInt32BE(d.length, o + 12);
    const pad = (4 - (d.length % 4)) % 4;
    body.push(d, Buffer.alloc(pad));
    offset += d.length + pad;
  });
  const out = Buffer.concat([header, ...body]);
  if (headIdx >= 0) {
    const headOff = header.readUInt32BE(12 + order.indexOf(headIdx) * 16 + 8);
    out.writeUInt32BE((0xB1B0AFBA - checksum(out)) >>> 0, headOff + 8);
  }
  return out;
}

module.exports = { renameFont, namesFor, WEIGHT_NAME };
