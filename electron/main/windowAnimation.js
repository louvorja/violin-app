"use strict";

/**
 * windowAnimation.js — Transições suaves de abertura e fechamento de janelas
 * auxiliares no Electron (Windows e macOS).
 *
 * Usa `performance.now()` (tempo de relógio, independente da taxa de timers do
 * sistema) com curva cúbica ease-out e passos em alta frequência (~120 Hz),
 * filtrando chamadas redundantes abaixo da precisão de 8 bits (1/255) do
 * compositor para entregar um fade fluido sem engasgos.
 *
 * No Linux, `BrowserWindow.setOpacity()` não é suportado pelo Electron; nesse
 * caso a animação é ignorada com segurança.
 */

const WINDOW_ANIMATION = Object.freeze({
  FADE: "fade",
  NONE: "none",
  SYSTEM: "system",
});

const DEFAULT_WINDOW_ANIMATION = WINDOW_ANIMATION.FADE;

/** Duração padrão do fade de entrada (ms) — espelha os ~250 ms do LouvorJA Classic. */
const OPEN_FADE_MS = 260;
/** Limites aceitos para a duração configurável do fade de janelas (ms). */
const MIN_FADE_MS = 100;
const MAX_FADE_MS = 800;
/** Duração padrão do fade de saída (ms) — ligeiramente mais rápido para sensação ágil. */
const CLOSE_FADE_MS = 200;
/** Pequeno respiro de 1 quadro para o compositor aplicar bounds/fullscreen antes de revelar. */
const REVEAL_SETTLE_MS = 16;
/** Intervalo alvo do loop de opacidade (~120 Hz) para evitar saltos visíveis. */
const TICK_MS = 8;
/** Limiar mínimo de delta de opacidade (~1 nível em 255) para evitar chamadas redundantes. */
const MIN_OPACITY_DELTA = 1 / 255;

/** Controladores de animação ativa por BrowserWindow (evita vazamento ao destruir). */
const _activeAnimations = new WeakMap();

/** Valida e normaliza a preferência vinda do renderer ou de `user_data`. */
function normalizeWindowAnimation(value) {
  if (
    value === WINDOW_ANIMATION.FADE ||
    value === WINDOW_ANIMATION.NONE ||
    value === WINDOW_ANIMATION.SYSTEM
  ) {
    return value;
  }
  return DEFAULT_WINDOW_ANIMATION;
}

/** Normaliza a duração do fade (ms) para um intervalo seguro e fluido. */
function normalizeWindowAnimationDuration(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return OPEN_FADE_MS;
  return Math.round(Math.min(MAX_FADE_MS, Math.max(MIN_FADE_MS, num)));
}

/** Duração de fechamento derivada da duração de abertura (~77%, mais ágil). */
function closeDurationFor(openDurationMs) {
  const normalized = normalizeWindowAnimationDuration(openDurationMs);
  if (normalized === OPEN_FADE_MS) return CLOSE_FADE_MS;
  return Math.round(Math.max(80, Math.min(600, normalized * 0.77)));
}

/** O SO atual suporta `BrowserWindow.setOpacity()`? */
function supportsWindowOpacity(platform = process.platform) {
  return platform === "win32" || platform === "darwin";
}

/** Lê a preferência de movimento reduzido do SO no Electron (seguro fora do Electron). */
function prefersReducedMotion(override) {
  if (typeof override === "boolean") return override;
  try {
    const { systemPreferences } = require("electron");
    return systemPreferences?.getAnimationSettings?.()?.prefersReducedMotion === true;
  } catch (_) {
    return false;
  }
}

/**
 * Esta janela deve controlar `opacity` na abertura/fechamento?
 *
 * Exclui modo `system` (mantém a animação nativa do SO), plataformas sem
 * suporte a `setOpacity` (Linux) e modo E2E invisível (`backgroundWindows`).
 */
function shouldControlOpacity(mode, { platform = process.platform, backgroundWindows = false, excluded = false } = {}) {
  if (backgroundWindows || excluded) return false;
  if (!supportsWindowOpacity(platform)) return false;
  return normalizeWindowAnimation(mode) !== WINDOW_ANIMATION.SYSTEM;
}

/** Curva cúbica ease-out: começa responsiva e desacelera suavemente no final. */
function easeOutCubic(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** Curva quadrática ease-out (mantida para compatibilidade). */
function easeOutQuad(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - (1 - clamped) * (1 - clamped);
}

/** Curva quadrática ease-in-out: dissolução uniforme sem corte abrupto no início. */
function easeInOutQuad(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
}

/** Cancela qualquer animação pendente para esta janela. */
function cancelAnimation(win) {
  if (!win) return;
  const cancel = _activeAnimations.get(win);
  if (typeof cancel === "function") {
    _activeAnimations.delete(win);
    cancel();
  }
}

function _safeSetOpacity(win, value) {
  if (!win || win.isDestroyed() || typeof win.setOpacity !== "function") return false;
  try {
    win.setOpacity(Math.max(0, Math.min(1, value)));
    return true;
  } catch (_) {
    return false;
  }
}

function _safeGetOpacity(win, fallback = 1) {
  if (!win || win.isDestroyed() || typeof win.getOpacity !== "function") return fallback;
  try {
    const val = win.getOpacity();
    return Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : fallback;
  } catch (_) {
    return fallback;
  }
}

function _animateOpacity(win, { from, to, durationMs, easing, onComplete, now = () => performance.now() }) {
  cancelAnimation(win);

  if (!win || win.isDestroyed()) {
    onComplete?.();
    return;
  }

  if (durationMs <= 0 || Math.abs(to - from) < MIN_OPACITY_DELTA) {
    _safeSetOpacity(win, to);
    onComplete?.();
    return;
  }

  let finished = false;
  let lastApplied = from;
  _safeSetOpacity(win, from);

  const startedAt = now();
  let timer = null;

  const cleanup = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (_activeAnimations.get(win) === stop) {
      _activeAnimations.delete(win);
    }
  };

  const stop = () => {
    finished = true;
    cleanup();
  };

  _activeAnimations.set(win, stop);

  const step = () => {
    if (finished || win.isDestroyed()) {
      cleanup();
      return;
    }
    const elapsed = Math.max(0, now() - startedAt);
    const progress = Math.min(1, elapsed / durationMs);
    const next = progress >= 1 ? to : from + (to - from) * easing(progress);

    if (progress >= 1 || Math.abs(next - lastApplied) >= MIN_OPACITY_DELTA) {
      lastApplied = next;
      _safeSetOpacity(win, next);
    }

    if (progress >= 1) {
      finished = true;
      cleanup();
      onComplete?.();
    }
  };

  timer = setInterval(step, TICK_MS);
  timer.unref?.();
}

/**
 * Revela uma janela já posicionada (e em fullscreen, se aplicável), aplicando o
 * efeito escolhido:
 * - `fade`: aguarda 1 quadro para o compositor estabilizar e sobe a opacidade
 *   de 0 → 1 com curva cúbica ease-out.
 * - `none`: aguarda 1 quadro invisível (evita o pulo de redimensionamento do
 *   Windows 11) e revela imediatamente em opacidade 1.
 * - `system`: não interfere na opacidade.
 */
function revealWindow(
  win,
  mode,
  {
    platform = process.platform,
    backgroundWindows = false,
    excluded = false,
    reducedMotion,
    settleMs = REVEAL_SETTLE_MS,
    durationMs = OPEN_FADE_MS,
    now = () => performance.now(),
  } = {}
) {
  const normalized = normalizeWindowAnimation(mode);
  if (!shouldControlOpacity(normalized, { platform, backgroundWindows, excluded })) return;
  if (!win || win.isDestroyed()) return;

  const effectiveMode =
    normalized === WINDOW_ANIMATION.FADE && prefersReducedMotion(reducedMotion)
      ? WINDOW_ANIMATION.NONE
      : normalized;

  cancelAnimation(win);

  let cancelled = false;
  let settleTimer = null;

  const cancelPending = () => {
    cancelled = true;
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const runReveal = () => {
    if (cancelled || win.isDestroyed()) return;
    if (effectiveMode === WINDOW_ANIMATION.NONE) {
      if (_activeAnimations.get(win) === cancelPending) _activeAnimations.delete(win);
      _safeSetOpacity(win, 1);
      return;
    }
    _animateOpacity(win, {
      from: 0,
      to: 1,
      durationMs,
      easing: easeOutCubic,
      now,
    });
  };

  if (settleMs <= 0) {
    runReveal();
    return;
  }

  _activeAnimations.set(win, cancelPending);
  settleTimer = setTimeout(runReveal, settleMs);
  settleTimer.unref?.();
}

/**
 * Fecha a janela respeitando o efeito configurado:
 * - `fade`: dissolve suavemente da opacidade atual até 0 e só então chama `doClose`.
 * - `none`: zera a opacidade antes de `doClose` para suprimir a animação nativa
 *   de fechamento do Windows 11.
 * - `system` (ou `immediate: true`): chama `doClose` diretamente.
 */
function closeWindowWithAnimation(
  win,
  mode,
  doClose,
  {
    platform = process.platform,
    backgroundWindows = false,
    excluded = false,
    reducedMotion,
    immediate = false,
    durationMs = CLOSE_FADE_MS,
    now = () => performance.now(),
  } = {}
) {
  if (!win || win.isDestroyed()) return;
  cancelAnimation(win);

  const normalized = normalizeWindowAnimation(mode);
  if (immediate || !shouldControlOpacity(normalized, { platform, backgroundWindows, excluded })) {
    doClose();
    return;
  }

  const visible = typeof win.isVisible === "function" ? win.isVisible() : true;
  if (!visible) {
    doClose();
    return;
  }

  const effectiveMode =
    normalized === WINDOW_ANIMATION.FADE && prefersReducedMotion(reducedMotion)
      ? WINDOW_ANIMATION.NONE
      : normalized;

  if (effectiveMode === WINDOW_ANIMATION.NONE) {
    _safeSetOpacity(win, 0);
    doClose();
    return;
  }

  const startOpacity = _safeGetOpacity(win, 1);
  if (startOpacity <= MIN_OPACITY_DELTA) {
    _safeSetOpacity(win, 0);
    doClose();
    return;
  }

  // Se interrompida no meio de um fade-in, escala a duração proporcionalmente.
  const scaledDuration = Math.max(40, Math.round(durationMs * startOpacity));
  _animateOpacity(win, {
    from: startOpacity,
    to: 0,
    durationMs: scaledDuration,
    easing: easeInOutQuad,
    now,
    onComplete: () => {
      if (!win.isDestroyed()) doClose();
    },
  });
}

module.exports = {
  WINDOW_ANIMATION,
  DEFAULT_WINDOW_ANIMATION,
  OPEN_FADE_MS,
  MIN_FADE_MS,
  MAX_FADE_MS,
  CLOSE_FADE_MS,
  REVEAL_SETTLE_MS,
  normalizeWindowAnimation,
  normalizeWindowAnimationDuration,
  closeDurationFor,
  supportsWindowOpacity,
  prefersReducedMotion,
  shouldControlOpacity,
  easeOutCubic,
  easeOutQuad,
  easeInOutQuad,
  cancelAnimation,
  revealWindow,
  closeWindowWithAnimation,
};
