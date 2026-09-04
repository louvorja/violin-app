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

/** Cleanups dos listeners de `change` de cada tela (resolução, densidade). */
let _perScreenCleanups: (() => void)[] = [];
let _screenListenerAttached = false;

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
    _details.addEventListener("screenschange", _onScreensChange);
    _details.addEventListener("currentscreenchange", _notify);
    _watchIndividualScreens();
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

/**
 * Assina o `change` de cada tela, que avisa sobre resolução e densidade — um
 * projetor renegociando 1080p→720p dispara isto, não `screenschange`.
 */
function _watchIndividualScreens(): void {
  for (const cleanup of _perScreenCleanups.splice(0)) cleanup();
  if (!_details) return;

  for (const screen of _details.screens) {
    screen.addEventListener("change", _notify);
    _perScreenCleanups.push(() => screen.removeEventListener("change", _notify));
  }
}

/** Uma tela entrou ou saiu: reassina as individuais e avisa. */
function _onScreensChange(): void {
  _watchIndividualScreens();
  _notify();
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

/**
 * Assina mudanças de tela. Devolve a função de cleanup.
 *
 * Funciona mesmo sem a permissão concedida: `window.screen` emite `change`
 * quando um monitor entra ou sai, e é o único aviso disponível antes de o
 * usuário autorizar a listagem completa.
 */
export function onChange(callback: () => void): () => void {
  _listeners.add(callback);

  if (!_screenListenerAttached && typeof window !== "undefined" && window.screen) {
    try {
      // `Screen` só virou EventTarget em navegadores recentes; o lib.dom ainda
      // não reflete isso.
      (window.screen as unknown as EventTarget).addEventListener("change", _notify);
      _screenListenerAttached = true;
    } catch {
      /* navegador sem o evento — resta o fallback de foco no chamador */
    }
  }

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

/**
 * Mostra um cartão "Monitor N" em cada tela, por alguns segundos.
 *
 * No Electron isso são janelas nativas sem moldura; no navegador o mais
 * próximo é um popup por tela. Popups em série costumam ser permitidos quando
 * partem de um clique, mas o navegador pode barrar os seguintes — por isso a
 * função devolve quantos realmente abriram, para a UI poder avisar.
 *
 * @returns quantidade de telas identificadas
 */
export function identify(durationMs = 5000): number {
  const screens = listScreens();
  const abertas: Window[] = [];

  screens.forEach((screen, index) => {
    const features = [
      "popup=yes",
      `left=${Math.round(screen.avail.x + screen.avail.width / 2 - 160)}`,
      `top=${Math.round(screen.avail.y + screen.avail.height / 2 - 100)}`,
      "width=320,height=200",
      "toolbar=no,location=no,menubar=no,status=no,scrollbars=no,resizable=no",
    ].join(",");

    const win = window.open("", `louvorja_identify_${index}`, features);
    if (!win) return;

    const nome = screen.label ? escapeHtml(screen.label) : "";
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Monitor ${index + 1}</title>
<style>
  html,body{margin:0;height:100%;background:#6366f1;color:#fff;
    font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;
    justify-content:center;overflow:hidden;user-select:none}
  .n{font-size:5.5rem;font-weight:100;line-height:1}
  .w{text-align:center}
  .l{font-size:1.05rem;font-weight:500;margin-top:4px}
  .s{font-size:.95rem;opacity:.85;margin-top:8px}
</style></head><body><div class="w">
  <div class="n">${index + 1}</div>
  ${nome ? `<div class="l">${nome}</div>` : ""}
  <div class="s">${screen.bounds.width} \u00D7 ${screen.bounds.height}${screen.primary ? " — Principal" : ""}</div>
</div></body></html>`);
    win.document.close();
    abertas.push(win);
  });

  setTimeout(() => {
    for (const win of abertas) {
      try {
        if (!win.closed) win.close();
      } catch {
        /* já fechada pelo usuário */
      }
    }
  }, durationMs);

  return abertas.length;
}

/** Escapa texto vindo do sistema antes de injetá-lo no HTML do cartão. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Estado da configuração "Tela cheia automática" do Chrome.
 *
 * Não dá para consultar pela Permissions API nem pedir por prompt — o Chrome
 * bloqueia de propósito, e só o usuário libera nas configurações. O que dá é
 * DEDUZIR: a janela de projeção tenta entrar em tela cheia sozinha ao abrir, e
 * o resultado dessa tentativa diz se a configuração está ativa. Guardamos aqui
 * para a tela de Opções poder mostrar o estado e orientar.
 */
const AUTO_FS_KEY = "louvorja:auto_fullscreen";

export type AutoFullscreenState = "unknown" | "granted" | "blocked";

/** Registra o resultado da última tentativa automática de tela cheia. */
export function setAutoFullscreenState(ok: boolean): void {
  try {
    localStorage.setItem(AUTO_FS_KEY, ok ? "granted" : "blocked");
  } catch {
    /* armazenamento indisponível — seguimos sem o registro */
  }
}

/** Último resultado conhecido, ou "unknown" se a projeção ainda não abriu. */
export function getAutoFullscreenState(): AutoFullscreenState {
  try {
    const v = localStorage.getItem(AUTO_FS_KEY);
    return v === "granted" || v === "blocked" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

/** Caminho da configuração no Chrome. Não é navegável por link nem por script. */
export const AUTO_FULLSCREEN_SETTINGS_PATH =
  "chrome://settings/content/automaticFullScreen";

/**
 * Objetos `ScreenDetailed` crus do navegador, na mesma ordem de `listScreens`.
 *
 * `requestFullscreen({ screen })` exige a instância que veio da API — o objeto
 * simplificado de `listScreens` não serve.
 */
export function rawScreens(): unknown[] {
  return _details ? _details.screens : [];
}

export default {
  identify,
  rawScreens,
  setAutoFullscreenState,
  getAutoFullscreenState,
  AUTO_FULLSCREEN_SETTINGS_PATH,
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
