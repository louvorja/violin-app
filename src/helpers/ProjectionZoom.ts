/**
 * Zoom de imagem e de página de PDF nas telas (tela principal e retorno).
 *
 * O operador escolhe o recorte no Modo apresentação; as janelas de projeção
 * só aplicam. O recorte é descrito pela escala e pelo centro, em frações do
 * próprio elemento (0–1), para valer igual em telas de tamanhos diferentes.
 * `key` (playback_id, ou a url) e `page` amarram o recorte a uma mídia e a uma
 * página: trocou de arquivo ou virou a página, o recorte antigo não vale e a
 * tela volta inteira sem precisar de aviso.
 */

export interface ProjectionZoom {
  key: string;
  page: number;
  scale: number;
  cx: number;
  cy: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

/** Escala dentro dos limites e centro que não deixa o recorte sair da imagem. */
export function clampZoom(z: ProjectionZoom): ProjectionZoom {
  const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(z.scale) || 1));
  const half = 1 / (2 * scale);
  const clamp = (v: number) => Math.min(1 - half, Math.max(half, Number.isFinite(v) ? v : 0.5));
  return { ...z, scale, cx: clamp(z.cx), cy: clamp(z.cy) };
}

/**
 * O estilo que leva o centro do recorte ao meio do elemento, ampliado. Sem
 * zoom (ou de outra mídia/página), nenhum estilo.
 */
export function zoomStyle(
  z: ProjectionZoom | null | undefined,
  key: string | null | undefined,
  page = 1
): Record<string, string> | undefined {
  if (!z || !key || z.key !== key || z.page !== page || z.scale <= 1) return undefined;
  const { scale, cx, cy } = clampZoom(z);
  const tx = (0.5 - cx) * scale * 100;
  const ty = (0.5 - cy) * scale * 100;
  return {
    transform: `translate(${tx}%, ${ty}%) scale(${scale})`,
    transformOrigin: "50% 50%",
  };
}

/** O payload do Broadcast vira um recorte válido (ou nada). */
export function zoomFromPayload(payload: unknown): ProjectionZoom | null {
  const p = payload as Partial<ProjectionZoom> | null;
  if (!p || typeof p.key !== "string" || !p.key) return null;
  return clampZoom({
    key: p.key,
    page: Number.isInteger(p.page) ? (p.page as number) : 1,
    scale: Number(p.scale),
    cx: Number(p.cx),
    cy: Number(p.cy),
  });
}
