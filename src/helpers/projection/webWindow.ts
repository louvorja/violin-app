/**
 * @category helper-puro — Janelas de projeção no web/PWA.
 *
 * Registry único das janelas abertas por feature. Antes `Projection.ts` e
 * `ProjectionWindows.ts` mantinham mapas separados, então uma janela aberta por
 * um deles era invisível para o outro.
 */

/**
 * Features do `window.open` para janelas de projeção.
 *
 * Sem `noopener`/`noreferrer` de propósito: por spec eles fazem `window.open`
 * devolver null, e sem essa referência `close()` e `isOpen()` nunca funcionaram
 * no navegador. A janela é da mesma origem e de uma rota do nosso próprio
 * router, então reverse tabnabbing não se aplica; o handle serve apenas para
 * foco, geometria e fechamento — dados seguem pelo BroadcastChannel.
 */
export const WEB_WINDOW_FEATURES =
  "popup=yes,width=1280,height=720,toolbar=no,location=no,menubar=no,status=no,scrollbars=no,resizable=yes";

const _windows: Record<string, Window | null> = {};

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * String de features posicionando a janela numa tela específica.
 *
 * Usada para abrir a projeção direto no projetor no web/PWA, em vez de deixar
 * o operador arrastar a janela e apertar F11 a cada culto.
 */
export function featuresForRect(rect: WindowRect | null): string {
  if (!rect) return WEB_WINDOW_FEATURES;
  return [
    "popup=yes",
    `left=${Math.round(rect.x)}`,
    `top=${Math.round(rect.y)}`,
    `width=${Math.round(rect.width)}`,
    `height=${Math.round(rect.height)}`,
    "toolbar=no,location=no,menubar=no,status=no,scrollbars=no,resizable=yes",
  ].join(",");
}

/**
 * Reposiciona a janela se o navegador ignorou `left`/`top` ou a reencaixou na
 * tela atual — comum quando os monitores têm densidades diferentes.
 *
 * Corrige uma vez só: insistir vira cabo de guerra com o gerenciador de janelas.
 */
export function nudgeIntoRect(win: Window | null, rect: WindowRect | null, delayMs = 300): void {
  if (!win || !rect) return;
  setTimeout(() => {
    try {
      if (win.closed) return;
      const centerX = win.screenX + win.outerWidth / 2;
      const centerY = win.screenY + win.outerHeight / 2;
      const inside =
        centerX >= rect.x && centerX <= rect.x + rect.width &&
        centerY >= rect.y && centerY <= rect.y + rect.height;
      if (inside) return;
      win.moveTo(Math.round(rect.x), Math.round(rect.y));
      win.resizeTo(Math.round(rect.width), Math.round(rect.height));
    } catch {
      /* janela fechada ou bloqueada — desiste */
    }
  }, delayMs);
}


/**
 * Abre (ou foca) a janela de projeção de uma feature.
 *
 * Síncrona de propósito: `window.open` precisa rodar no mesmo task do gesto do
 * usuário, senão o bloqueador de popup barra a janela.
 */
export function openWebWindow(
  feature: string,
  route: string,
  features: string = WEB_WINDOW_FEATURES
): Window | null {
  const existing = _windows[feature];
  if (existing && !existing.closed) {
    existing.focus();
    return existing;
  }
  _windows[feature] = window.open(route, `louvorja_${feature}`, features);
  return _windows[feature];
}

/** Handle da janela da feature, ou null se não houver janela aberta. */
export function getWebWindow(feature: string): Window | null {
  const win = _windows[feature];
  return win && !win.closed ? win : null;
}

/** Fecha a janela da feature, se estiver aberta. */
export function closeWebWindow(feature: string): void {
  const win = _windows[feature];
  if (win && !win.closed) win.close();
  _windows[feature] = null;
}

/** True se a feature tem janela web aberta. */
export function isWebWindowOpen(feature: string): boolean {
  const win = _windows[feature];
  return !!win && !win.closed;
}

/**
 * True se qualquer feature tem janela aberta.
 *
 * Síncrona de propósito: `beforeunload` não pode esperar promessa, e é ali que
 * decidimos se vale avisar o usuário antes de recarregar.
 */
export function hasOpenWebWindows(): boolean {
  return Object.values(_windows).some((win) => !!win && !win.closed);
}
