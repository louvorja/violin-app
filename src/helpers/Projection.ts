/**
 * @category helper-puro — Camada única para abrir telas em monitores específicos.
 *
 * Web/PWA: usa window.open + BroadcastChannel.
 * Desktop (Electron): usa Platform.windows.open + Platform.displays para
 * posicionar a janela no monitor escolhido (D4).
 *
 * Cada chamada precisa de um `feature` (string única que identifica a projeção
 * — ex: "bible", "music", "obs-bible"). A preferência de monitor é persistida
 * por feature via Platform.displays.setPreferred() no desktop e via UserData
 * em fallback web.
 */

import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { CategorizedDisplays, DisplayInfo, NativeDisplay, OpenOptions } from "@/types/Projection";
import {
  closeWebWindow,
  featuresForRect,
  isWebWindowOpen,
  nudgeIntoRect,
  openWebWindow,
} from "@/helpers/projection/webWindow";
import WebRoles from "@/helpers/projection/WebRoles";
import WebDisplays from "@/helpers/projection/WebDisplays";
import { roleOfFeature } from "@/helpers/DisplayRoles";

/**
 * Fallback hierárquico — quando uma feature não tem monitor explicitamente
 * escolhido, herda do grupo default:
 *
 *   "presentation" → mesma tela usada para projetar slides de música
 *   "return"       → mesma tela do stage display (retorno)
 *
 * Assim, configurar "Monitor 2" para projeção uma vez já leva a Bíblia,
 * sorteios, cronômetro etc. para lá. O Relógio cai no monitor de retorno.
 */
const FEATURE_GROUP: Record<string, "presentation" | "return"> = {
  // Apresentação principal — segue "musicas" (projection)
  bible: "presentation",
  counter: "presentation",
  draw: "presentation",
  name_draw: "presentation",
  message_board: "presentation",
  stopwatch: "presentation",
  timer: "presentation",
  // Stage display / monitor de retorno (visível ao músico/operador)
  clock: "return",
};

const GROUP_TO_FEATURE = {
  presentation: "musicas", // alinhado com ProjectionWindows.ts FEATURE_PROJECTION
  return: "retorno",        // FEATURE_RETURN
} as const;

function _featureKey(feature: string): string {
  // Mantém compat com features já usadas em ProjectionWindows.ts
  // ("musicas", "operador", "retorno") — passa direto.
  return feature;
}

/** Retorna a feature de fallback para um módulo, ou null se não houver. */
function _fallbackFeature(feature: string): string | null {
  const group = FEATURE_GROUP[feature];
  return group ? GROUP_TO_FEATURE[group] : null;
}

async function _getDisplaysApi() {
  return Platform.isDesktop ? Platform.displays : null;
}

async function _getWindowsApi() {
  return Platform.isDesktop ? Platform.windows : null;
}

/** Lista os monitores disponíveis. Web/PWA retorna um único "monitor" lógico. */
export async function listDisplays(): Promise<DisplayInfo[]> {
  const api = await _getDisplaysApi();
  if (api?.list) {
    try {
      const list = (await api.list()) as NativeDisplay[];
      return list.map((d, i) => ({
        id: d.id,
        label: d.label || `Monitor ${i + 1}`,
        primary: !!d.primary,
        bounds: d.bounds,
      }));
    } catch (e) {
      console.warn("[Projection] displays.list falhou:", e);
    }
  }
  // Web/PWA: as telas vêm da Window Management API. Reaproveita um acesso já
  // concedido — sem ele o navegador só conta a tela atual, e o menu de monitores
  // ficava com uma única entrada fictícia que nunca posicionava nada.
  await WebDisplays.restoreAccess();
  const screens = WebDisplays.listScreens();
  if (screens.length > 1) {
    return screens.map((screen) => ({
      id: screen.id,
      label: screen.label ? `Monitor ${screen.index + 1} — ${screen.label}` : `Monitor ${screen.index + 1}`,
      primary: screen.primary,
      bounds: screen.bounds,
    }));
  }

  if (typeof window !== "undefined" && window.screen) {
    return [
      {
        id: null,
        label: "Tela atual",
        primary: true,
        bounds: { x: 0, y: 0, width: window.screen.width, height: window.screen.height },
      },
    ];
  }
  return [];
}


export async function getCategorizedDisplays(): Promise<CategorizedDisplays> {
  const displays = await listDisplays();

  const primaryId = $userdata.get(KEYS.OPTIONS.DISPLAYS.PRIMARY, null);
  const secondaryId = $userdata.get(KEYS.OPTIONS.DISPLAYS.SECONDARY, null);
  // `id === null` é a tela genérica do navegador, não um monitor escolhível:
  // sem esta guarda ela casava com os dois papéis e o menu mostrava "Tela
  // principal" e "Tela de retorno" apontando para a mesma janela.
  const primaryDisplay = primaryId == null ? undefined : displays.find((d) => d.id === primaryId);
  const secondaryDisplay =
    secondaryId == null ? undefined : displays.find((d) => d.id === secondaryId);
  return {
    primaryDisplay,
    secondaryDisplay,
    primaryLabel: primaryDisplay?.label || (primaryId ? `Monitor ${primaryId}` : null),
    secondaryLabel: secondaryDisplay?.label || (secondaryId ? `Monitor ${secondaryId}` : null),
    // Telas sem id são a janela atual, não um monitor escolhível.
    otherDisplays: displays.filter(
      (d) => d.id != null && d.id !== primaryDisplay?.id && d.id !== secondaryDisplay?.id
    ),
  };
}

async function _getRawPreferred(feature: string): Promise<number | string | null> {
  const api = await _getDisplaysApi();
  if (api?.getPreferred) {
    try {
      const pref = (await api.getPreferred(_featureKey(feature))) as
        | { id?: number | null }
        | number
        | null;
      if (pref && typeof pref === "object") return pref.id ?? null;
      if (typeof pref === "number") return pref;
      return null;
    } catch {
      /* falha silenciosa — usa fallback */
    }
  }
  const prefs =
    ($userdata.get(KEYS.OPTIONS.DISPLAYS.PREFERRED, {}) as Record<string, number | string | null>) ??
    {};
  return prefs[feature] ?? null;
}

/**
 * Retorna o monitorId preferido da feature, ou null se "mesma janela".
 *
 * Aplica fallback hierárquico:
 *   1. Tenta a preferência explícita da feature (ex: "clock")
 *   2. Se nada, herda do grupo (ex: clock -> "retorno", bible -> "musicas")
 *   3. Se ainda nada, retorna null (mesma janela)
 *
 * Use { explicit: true } para pegar SOMENTE a preferência explícita
 * (sem aplicar fallback) — útil para mostrar "Padrão" no botão.
 */
export async function getPreferredMonitor(
  feature: string,
  opts: { explicit?: boolean } = {}
): Promise<number | string | null> {
  const own = await _getRawPreferred(feature);
  if (own != null || opts.explicit) return own;

  const fallback = _fallbackFeature(feature);
  if (fallback) return await _getRawPreferred(fallback);

  return null;
}

/** Retorna a feature usada como fallback (ex: "musicas" para bible). */
export function getFallbackFeature(feature: string): string | null {
  return _fallbackFeature(feature);
}

/** True se a feature está usando a preferência herdada (sem escolha explícita). */
export async function isUsingFallback(feature: string): Promise<boolean> {
  const own = await _getRawPreferred(feature);
  return own == null && _fallbackFeature(feature) != null;
}

/** Salva o monitorId preferido para a feature. Use null para "mesma janela". */
export async function setPreferredMonitor(
  feature: string,
  monitorId: number | string | null
): Promise<void> {
  const api = await _getDisplaysApi();
  if (api?.setPreferred) {
    try {
      await api.setPreferred(_featureKey(feature), monitorId);
      return;
    } catch {
      /* falha silenciosa — usa fallback */
    }
  }
  const prefs = {
    ...(($userdata.get(KEYS.OPTIONS.DISPLAYS.PREFERRED, {}) as Record<
      string,
      number | string | null
    >) ?? {}),
  };
  if (monitorId == null) delete prefs[feature];
  else prefs[feature] = monitorId;
  $userdata.set(KEYS.OPTIONS.DISPLAYS.PREFERRED, prefs);
}

/**
 * No navegador, true quando as telas só aparecem depois de o usuário autorizar
 * o "Gerenciamento de janelas". Sem isso o menu de monitores fica vazio e não
 * há como o operador descobrir o porquê.
 */
export async function needsScreenAccess(): Promise<boolean> {
  if (Platform.isDesktop || !WebDisplays.isSupported()) return false;
  return (await WebDisplays.permissionState()) !== "granted";
}

/** Pede o acesso às telas. Precisa ser chamada de dentro de um clique. */
export async function requestScreenAccess(): Promise<boolean> {
  return (await WebDisplays.requestAccess()) === "granted";
}

/** Mostra overlay "Monitor N" em todos os displays por durationMs (default 5000). */
export async function identifyDisplays(durationMs = 5000): Promise<void> {
  const api = await _getDisplaysApi();
  if (api?.identify) {
    try {
      await api.identify(durationMs);
    } catch (e) {
      console.warn("[Projection] displays.identify falhou:", e);
    }
  }
}

/** Verifica se a feature já está com janela aberta. */
export async function isOpen(feature: string): Promise<boolean> {
  const api = await _getWindowsApi();
  if (api?.listOpen) {
    try {
      const open = (await api.listOpen()) as string[];
      return open.includes(feature);
    } catch {
      /* fallback */
    }
  }
  return isWebWindowOpen(feature);
}

/**
 * Geometria da tela do papel que a feature usa, para abrir o popup já no
 * projetor. Síncrona de propósito — ver `openWebWindow`.
 */
function _webRectFor(feature: string): { x: number; y: number; width: number; height: number } | null {
  try {
    const chosen =
      ($userdata.get(KEYS.OPTIONS.DISPLAYS.FEATURE_ROLES, {}) as Record<string, string>) ?? {};
    // Escolha explícita do usuário ou o padrão do módulo — exigir a explícita
    // deixava a janela abrir sem posição, na tela do operador.
    const role = feature in chosen ? chosen[feature] : roleOfFeature(feature);
    if (!role) return null;

    const screen = WebRoles.screenForRole(role);
    if (!screen) return null;
    // Área útil da tela: é o máximo que uma janela comum consegue ocupar (fora
    // dela ficam barra de menu e dock, que o sistema não deixa cobrir sem tela
    // cheia real).
    return {
      x: screen.avail.x,
      y: screen.avail.y,
      width: screen.avail.width,
      height: screen.avail.height,
    };
  } catch {
    return null;
  }
}

/**
 * Geometria de um monitor escolhido à mão no navegador ("screen-N").
 *
 * Síncrona pelo mesmo motivo de `_webRectFor`: qualquer espera antes do
 * `window.open` custa a ativação transitória do clique.
 */
function _webRectForMonitor(
  monitorId: number | string | null | undefined
): { x: number; y: number; width: number; height: number } | null {
  if (monitorId == null) return null;
  const screen = WebDisplays.listScreens().find((s) => s.id === String(monitorId));
  if (!screen) return null;
  return {
    x: screen.avail.x,
    y: screen.avail.y,
    width: screen.avail.width,
    height: screen.avail.height,
  };
}

/** Abre a janela de projeção no monitor escolhido (ou no preferido). */
export async function open(opts: OpenOptions): Promise<void> {
  // Web/PWA primeiro e sem nenhum `await` antes: qualquer espera aqui consome a
  // ativação transitória do clique e o popup é bloqueado.
  if (!Platform.isDesktop) {
    // Monitor escolhido no menu tem prioridade sobre o papel configurado em
    // Opções — é a escolha mais recente e mais específica do operador.
    const rect = _webRectForMonitor(opts.monitorId) ?? _webRectFor(opts.feature);
    const win = openWebWindow(opts.feature, opts.route, featuresForRect(rect));
    nudgeIntoRect(win, rect);
    return;
  }

  const monitorId = opts.monitorId ?? (await getPreferredMonitor(opts.feature));
  const fullscreen = opts.fullscreen ?? true;
  const alwaysOnTop = opts.alwaysOnTop ?? false;
  const frame = opts.frame ?? !fullscreen;

  const api = await _getWindowsApi();
  if (api?.open) {
    try {
      await api.open({
        route: opts.route,
        feature: opts.feature,
        monitorId: monitorId ?? null,
        fullscreen,
        frame,
        alwaysOnTop,
      });
      return;
    } catch (e) {
      console.warn("[Projection] windows.open falhou, fallback web:", e);
    }
  }

  // A API desktop falhou — último recurso.
  openWebWindow(opts.feature, opts.route);
}

/** Fecha a janela da feature, se estiver aberta. */
export async function close(feature: string): Promise<void> {
  const api = await _getWindowsApi();
  if (api?.close) {
    try {
      await api.close(feature);
    } catch {
      /* noop */
    }
  }
  closeWebWindow(feature);
}

/** Toggle aberto/fechado, com monitor opcional. Útil para botão de projeção. */
export async function toggle(opts: OpenOptions): Promise<boolean> {
  if (await isOpen(opts.feature)) {
    await close(opts.feature);
    return false;
  }
  await open(opts);
  return true;
}

export default {
  listDisplays,
  needsScreenAccess,
  requestScreenAccess,
  getPreferredMonitor,
  setPreferredMonitor,
  identifyDisplays,
  isOpen,
  open,
  close,
  toggle,
  getFallbackFeature,
  isUsingFallback,
};
