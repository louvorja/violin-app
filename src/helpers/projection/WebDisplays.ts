/**
 * @category helper-puro — Monitores no navegador (Window Management API).
 *
 * No web não existe a API de displays do Electron, mas navegadores baseados em
 * Chromium expõem `window.getScreenDetails()`, que dá posição, tamanho e nome
 * de cada tela. Com isso o popup de projeção abre direto no projetor, em vez de
 * o operador ter que arrastar a janela e apertar F11 em todo culto.
 *
 * Firefox e Safari não têm a API: lá o módulo se declara sem suporte e o
 * chamador cai no modo manual.
 */

import { identityFromDisplay, type MonitorIdentity } from "@/helpers/MonitorIdentity";

/** Uma tela como o navegador a descreve. */
export interface WebScreen {
  id: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  /** Área útil, fora de barras do sistema. */
  avail: { x: number; y: number; width: number; height: number };
  primary: boolean;
  internal: boolean;
  scaleFactor: number;
  index: number;
}

export type PermissionState = "granted" | "prompt" | "denied" | "unsupported";

/** Recorte do que usamos de `ScreenDetailed` (ainda fora do lib.dom padrão). */
interface ScreenDetailed extends EventTarget {
  left: number;
  top: number;
  width: number;
  height: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
  isInternal: boolean;
  label: string;
  devicePixelRatio: number;
}

interface ScreenDetails extends EventTarget {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

/**
 * Mantido vivo de propósito: este objeto é a única fonte de `screens` e dos
 * eventos de mudança. Descartá-lo e pedir outro perde a reatividade.
 */
let _details: ScreenDetails | null = null;
const _listeners = new Set<() => void>();

/** A API existe neste navegador? */
export function isSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as never as {
    getScreenDetails?: unknown;
  }).getScreenDetails === "function";
}

/** Há mais de uma tela? Responde sem exigir permissão. */
export function isExtended(): boolean {
  if (typeof window === "undefined" || !window.screen) return false;
  return (window.screen as Screen & { isExtended?: boolean }).isExtended === true;
}

/** Estado da permissão, sem provocar o prompt. */
export async function permissionState(): Promise<PermissionState> {
  if (!isSupported()) return "unsupported";
  if (typeof navigator === "undefined" || !navigator.permissions) return "prompt";

  // O nome mudou de "window-placement" para "window-management"; consultar um
  // nome desconhecido lança TypeError, daí as duas tentativas protegidas.
  for (const name of ["window-management", "window-placement"]) {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return status.state as PermissionState;
    } catch {
      /* nome não suportado — tenta o próximo */
    }
  }
  return "prompt";
}

/**
 * Pede acesso às telas e guarda o handle.
 *
 * O navegador exige ativação transitória: chame de dentro de um clique, nunca
 * no boot. Uma vez negada, não há como pedir de novo por código — o usuário
 * precisa liberar pelo cadeado da barra de endereços.
 */
export async function requestAccess(): Promise<PermissionState> {
  if (!isSupported()) return "unsupported";
  if (_details) return "granted";

  try {
    const api = window as never as { getScreenDetails: () => Promise<ScreenDetails> };
    _details = await api.getScreenDetails();
    _details.addEventListener("screenschange", _notify);
    _details.addEventListener("currentscreenchange", _notify);
    _notify();
    return "granted";
  } catch {
    return "denied";
  }
}

/** Reconecta a um acesso já concedido, sem provocar prompt. */
export async function restoreAccess(): Promise<boolean> {
  if (_details) return true;
  if ((await permissionState()) !== "granted") return false;
  return (await requestAccess()) === "granted";
}

function _notify(): void {
  for (const listener of _listeners) {
    try {
      listener();
    } catch (err) {
      console.error("[WebDisplays] listener falhou:", err);
    }
  }
}

/** Assina mudanças de tela. Devolve a função de cleanup. */
export function onChange(callback: () => void): () => void {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

/**
 * Telas disponíveis.
 *
 * Sem permissão concedida devolve apenas a tela atual, que é tudo o que o
 * navegador conta sem autorização.
 */
export function listScreens(): WebScreen[] {
  if (!_details) {
    if (typeof window === "undefined" || !window.screen) return [];
    const s = window.screen;
    return [
      {
        id: "current",
        label: "",
        bounds: { x: 0, y: 0, width: s.width, height: s.height },
        avail: { x: 0, y: 0, width: s.availWidth, height: s.availHeight },
        primary: true,
        internal: true,
        scaleFactor: window.devicePixelRatio || 1,
        index: 0,
      },
    ];
  }

  return _details.screens.map((screen, index) => ({
    // Sem id estável no web: a identidade vem do fingerprint, não daqui.
    id: `screen-${index}`,
    label: typeof screen.label === "string" ? screen.label.trim() : "",
    bounds: { x: screen.left, y: screen.top, width: screen.width, height: screen.height },
    avail: {
      x: screen.availLeft,
      y: screen.availTop,
      width: screen.availWidth,
      height: screen.availHeight,
    },
    primary: !!screen.isPrimary,
    internal: !!screen.isInternal,
    scaleFactor: screen.devicePixelRatio || 1,
    index,
  }));
}

/**
 * Converte uma tela do navegador no mesmo fingerprint usado no desktop, para
 * reaproveitar o algoritmo de reconciliação.
 *
 * `source: "web"` impede que estas identidades sejam comparadas com as do
 * Electron: as unidades de `px` e de posição não são equivalentes.
 */
export function identityOf(screen: WebScreen): MonitorIdentity {
  const identity = identityFromDisplay(
    {
      id: null,
      label: screen.label,
      bounds: screen.bounds,
      scaleFactor: screen.scaleFactor,
      internal: screen.internal,
      primary: screen.primary,
    },
    screen.index
  );
  return { ...identity, source: "web", nativeId: null, rotation: null };
}

/** Fingerprints de todas as telas, na ordem em que o navegador as reporta. */
export function listIdentities(): MonitorIdentity[] {
  return listScreens().map(identityOf);
}

export default {
  isSupported,
  isExtended,
  permissionState,
  requestAccess,
  restoreAccess,
  onChange,
  listScreens,
  listIdentities,
  identityOf,
};
