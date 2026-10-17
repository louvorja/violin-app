/**
 * Cor com alfa aplicado — o que o painel de formatação precisa para "cor +
 * transparência" sem guardar `rgba()` numa string de configuração.
 *
 * O seletor de cor do painel (`<input type="color">`) só devolve `#RRGGBB`: a
 * transparência não cabe nele. Nos slides o mesmo par existe separado
 * (`text_bg_opacity` + cor fixa); aqui a cor é livre e o alfa é o segundo
 * controle.
 *
 * @category helper-puro — Sem APIs Vue; seguro no Electron main process.
 */

/** Limita um número a 0..100 e devolve o alfa correspondente (0..1). */
function _alfa(opacidade: number): number {
  const n = Number(opacidade);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(100, n)) / 100;
}

/** Expande `#RGB` e `#RGBA` para `#RRGGBBAA`. */
function _normalizarHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  const corpo = hex.slice(1);
  const curto = corpo.length === 3 || corpo.length === 4;
  const algarismos = curto ? corpo.split("") : (corpo.match(/.{2}/g) ?? []);
  if (curto ? corpo.length !== 4 && corpo.length !== 3 : corpo.length !== 6 && corpo.length !== 8) {
    return null;
  }
  if (!algarismos.every((p) => /^[0-9a-f]{1,2}$/i.test(p))) return null;
  const [r, g, b, a] = algarismos.map((p) => parseInt(p.length === 1 ? p + p : p, 16));
  return {
    r,
    g,
    b,
    /* Alfa já normalizado em 0..1 — igual ao que sai de rgb()/rgba(), para
       os dois caminhos entrarem na mesma conta. */
    a: a === undefined ? 1 : a / 255,
  };
}

/** Lê `rgb()`, `rgba()` e variações com espaço. */
function _lerFuncional(valor: string): { r: number; g: number; b: number; a: number } | null {
  const partes = valor.match(
    /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/\s]\s*([\d.]+%?)\s*)?\)$/i
  );
  if (!partes) return null;
  const canais = partes
    .slice(1, 4)
    .map((p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
  if (canais.some((n) => !Number.isFinite(n))) return null;
  const alfaBruto = partes[4];
  const alfa =
    alfaBruto === undefined
      ? 1
      : alfaBruto.endsWith("%")
        ? parseFloat(alfaBruto) / 100
        : parseFloat(alfaBruto);
  return {
    r: Math.round(canais[0]),
    g: Math.round(canais[1]),
    b: Math.round(canais[2]),
    a: Number.isFinite(alfa) ? alfa : 1,
  };
}

/**
 * Aplica a opacidade (0–100) sobre uma cor qualquer.
 *
 * O alfa final **multiplica** o que a cor já tiver: uma cor que já veio
 * semitransparente não fica mais opaca do que estava. Cor irreconhecível volta
 * como veio — um valor inválido não pode virar `undefined` no estilo da tela.
 */
export function corComAlfa(cor: string | null | undefined, opacidade = 100): string {
  const bruta = String(cor ?? "").trim();
  if (!bruta) return "transparent";
  if (bruta.toLowerCase() === "transparent") return "transparent";

  const deHex = bruta.startsWith("#") ? _normalizarHex(bruta) : null;
  const lida = deHex || (!bruta.startsWith("#") ? _lerFuncional(bruta) : null);
  if (!lida) return bruta;

  const alfa = lida.a * _alfa(opacidade);
  /* `rgba()` e não `hex8`:Safari/Chromium antigos aceitam rgba em qualquer lugar,
     e é o mesmo formato que os slides já usam. */
  return `rgba(${lida.r}, ${lida.g}, ${lida.b}, ${Number(alfa.toFixed(3))})`;
}

/** Largura de borda em px — ignora valores absurdos vindos de arquivo antigo. */
export function larguraDeBorda(valor: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(20, n));
}

/** Raio de borda em px. */
export function raioDeBorda(valor: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(50, n));
}
