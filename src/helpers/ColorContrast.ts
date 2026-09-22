/**
 * Clareia uma cor hex até atingir contraste mínimo contra o corpo escuro do
 * ribbon, preservando matiz e saturação.
 *
 * A paleta de cores dos módulos (manifests) foi extraída do Delphi pensando
 * em fundo claro — no tema `dark` (`--lj-body-bg: #1f2937`), ~40% delas ficam
 * abaixo de 3:1 de contraste (WCAG non-text) e somem contra o fundo. Em vez
 * de reescrever cada `color:` de manifest com uma segunda variante "escura",
 * esta função ajusta em runtime só quando o contraste já falha.
 */

const DARK_RIBBON_BG = "#1f2937"; // --lj-body-bg em [data-theme="dark"], ver tokens.css
const MIN_CONTRAST = 3;
const MAX_LIGHTNESS = 78; // teto pra não estourar em branco

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  switch (max) {
    case rn:
      h = ((gn - bn) / d) % 6;
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
  }
  h *= 60;
  if (h < 0) h += 360;
  return [h, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let rgb: Rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255)) as Rgb;
}

function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const DARK_BG_RGB = hexToRgb(DARK_RIBBON_BG);
const cache = new Map<string, string>();

/** Só mexe em hex `#rrggbb`; `var(--x)`, `currentColor` etc. passam direto. */
export function ensureContrastOnDark(color: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color;

  const cached = cache.get(color);
  if (cached) return cached;

  const rgb = hexToRgb(color);
  if (contrastRatio(rgb, DARK_BG_RGB) >= MIN_CONTRAST) {
    cache.set(color, color);
    return color;
  }

  const [h, s, l] = rgbToHsl(rgb);
  let lightness = l;
  let result = color;
  while (lightness < MAX_LIGHTNESS) {
    lightness += 2;
    const candidateRgb = hslToRgb(h, s, lightness);
    result = rgbToHex(candidateRgb);
    if (contrastRatio(candidateRgb, DARK_BG_RGB) >= MIN_CONTRAST) break;
  }
  cache.set(color, result);
  return result;
}
