'use strict';
/**
 * Utilitários de nomes de fontes — normalização e correspondência.
 * "Montserrat Black", "Montserrat-Black" e "montserrat black" viram "montserratblack".
 */

const STYLE_WORDS = [
  'thin', 'hairline', 'extralight', 'ultralight', 'light', 'book', 'regular', 'normal',
  'medium', 'semibold', 'demibold', 'demi', 'bold', 'extrabold', 'ultrabold', 'heavy', 'black',
  'extrablack', 'ultrablack', 'italic', 'oblique', 'condensed', 'semicondensed', 'expanded',
];

// Peso numérico de cada palavra de estilo (padrão CSS / Google Fonts)
const WEIGHTS = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, book: 400,
  regular: 400, normal: 400, medium: 500, semibold: 600, demibold: 600, demi: 600,
  bold: 700, extrabold: 800, ultrabold: 800, heavy: 900, black: 900, extrablack: 950, ultrablack: 950,
};

function norm(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\((truetype|opentype|type 1|vga res)\)/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Quebra "Montserrat ExtraBold Italic" em { base: "Montserrat", styles: ["extrabold","italic"] } */
function splitStyle(name) {
  const words = String(name || '').replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean);
  const styles = [];
  while (words.length > 1) {
    // "Extra Bold" / "Semi Bold" separados — confere as duas palavras primeiro
    if (words.length > 2) {
      const two = norm(words[words.length - 2] + words[words.length - 1]);
      if (STYLE_WORDS.includes(two)) { styles.unshift(two); words.pop(); words.pop(); continue; }
    }
    const last = norm(words[words.length - 1]);
    if (STYLE_WORDS.includes(last)) { styles.unshift(last); words.pop(); continue; }
    break;
  }
  return { base: words.join(' '), styles };
}

/** Conjunto de nomes instalados (normalizados) a partir da resposta de fonts.list do bridge */
function buildInstalledIndex({ families = [], registry = [], entries = null } = {}, extra = []) {
  const set = new Set();
  for (const f of families) set.add(norm(f));
  // entries = [{ name, path, exists }] — só conta se o arquivo da fonte ainda existe
  if (entries) registry = entries.filter(e => e.exists !== false).map(e => e.name);
  for (const r of registry) {
    // "Cambria & Cambria Math (TrueType)" → dois nomes
    for (const part of String(r).replace(/\(.*?\)/g, '').split('&')) {
      const n = norm(part);
      if (!n) continue;
      set.add(n);
      // "Arial Bold" registrado significa que a família "Arial" existe — mas só para os
      // estilos clássicos (regular/negrito/itálico). "Montserrat Black" NÃO implica "Montserrat".
      const { base, styles } = splitStyle(part.trim());
      const ribbi = ['regular', 'normal', 'bold', 'italic', 'oblique'];
      if (base && styles.length && styles.every(s => ribbi.includes(s))) set.add(norm(base));
    }
  }
  for (const e of extra) set.add(norm(e));
  return set;
}

function isInstalled(index, typeface) {
  const n = norm(typeface);
  if (!n) return true;
  return index.has(n);
}

// Fontes "na nuvem" do Office 365: o PowerPoint baixa sozinho quando precisa (com internet)
const OFFICE_CLOUD = /^(aptos|grandview|seaford|skeena|tenorite|bierstadt|avenir next lt pro|segoe ui variable)\b/i;
const isOfficeCloud = name => OFFICE_CLOUD.test(String(name || '').trim());

module.exports = { isOfficeCloud, norm, splitStyle, buildInstalledIndex, isInstalled, WEIGHTS, STYLE_WORDS };
