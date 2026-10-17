/**
 * Geometria de uma página de PDF no palco — escala do viewport e tamanho do
 * canvas.
 *
 * O canvas é raster: 1 px de fundo vale 1 px CSS. Num telão 4K, ou no Windows
 * com escala de 150 %, o browser ampliaria essa imagem e borraria a página — é
 * isso que o `devicePixelRatio` corrige, mandando o pdf.js desenhar em pixels
 * de DISPOSITIVO. O tamanho em CSS continua em px de layout (`/ dpr`), senão a
 * página apareceria dobrada na tela.
 *
 * Devolve `null` quando ainda não há palco medido: viewport de 0 não renderiza
 * nada de útil e o pdf.js reclama. Melhor não tocar no canvas e deixar o
 * próximo ciclo pintar.
 *
 * @category helper-puro
 */

export interface PdfPageFit {
  /** Escala do viewport — pixels de canvas por unidade do PDF. */
  scale: number;
  /** Tamanho em CSS (px de layout). */
  cssWidth: number;
  cssHeight: number;
  /** Tamanho do backing store (px de dispositivo). */
  pixelWidth: number;
  pixelHeight: number;
}

export function pdfPageFit(p: {
  pageWidth: number;
  pageHeight: number;
  parentWidth: number;
  parentHeight: number;
  devicePixelRatio?: number;
}): PdfPageFit | null {
  if (!(p.pageWidth > 0) || !(p.pageHeight > 0)) return null;
  if (!(p.parentWidth > 0) || !(p.parentHeight > 0)) return null;

  const cssScale = Math.min(p.parentWidth / p.pageWidth, p.parentHeight / p.pageHeight);
  if (!(cssScale > 0)) return null;

  const dpr = Math.max(1, p.devicePixelRatio || 1);
  const scale = cssScale * dpr;
  const pixelWidth = Math.max(1, Math.round(p.pageWidth * scale));
  const pixelHeight = Math.max(1, Math.round(p.pageHeight * scale));

  return {
    scale,
    pixelWidth,
    pixelHeight,
    cssWidth: Math.max(1, Math.round(pixelWidth / dpr)),
    cssHeight: Math.max(1, Math.round(pixelHeight / dpr)),
  };
}
