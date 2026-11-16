"use strict";

/**
 * Validadores dos payloads do Player/Cronômetro compartilhados entre a rota
 * HTTP (`remoteRoutes/player.js`) e o relay SSE (`events.js`).
 *
 * Antes cada arquivo tinha a própria cópia de `isMediaState`,
 * `isStopwatchState` e da validação de voltas. Uma mudança em um lado (ex.: o
 * campo `subtitle`) podia fazer HTTP e SSE aceitarem contratos diferentes.
 */

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isMediaState(state) {
  if (!isPlainObject(state)) return false;
  for (const key of [
    "active",
    "playing",
    "loading",
    "minimized",
    "canPlay",
    "canPause",
    "canSeek",
    "canNext",
    "canPrevious",
  ]) {
    if (typeof state[key] !== "boolean") return false;
  }
  if (state.source !== "file" && state.source !== "youtube") return false;
  if (typeof state.title !== "string" || state.title.length > 4_096) return false;
  if (typeof state.subtitle !== "string" || state.subtitle.length > 4_096) return false;
  if (typeof state.fileName !== "string" || state.fileName.length > 4_096) return false;
  if (!isFiniteNumber(state.position) || state.position < 0) return false;
  if (!isFiniteNumber(state.duration) || state.duration < 0) return false;
  return Number.isSafeInteger(state.seq) && state.seq >= 0;
}

function isStopwatchLap(lap) {
  return (
    isPlainObject(lap) &&
    Number.isInteger(lap.index) &&
    lap.index > 0 &&
    isFiniteNumber(lap.elapsed) &&
    lap.elapsed >= 0 &&
    isFiniteNumber(lap.shown)
  );
}

function isStopwatchState(state) {
  if (!isPlainObject(state)) return false;
  if (typeof state.running !== "boolean") return false;
  if (state.mode !== "countup" && state.mode !== "countdown") return false;
  if (!isFiniteNumber(state.elapsed) || state.elapsed < 0) return false;
  if (state.target !== null && (!isFiniteNumber(state.target) || state.target < 0)) return false;
  if (state.remaining !== null && !isFiniteNumber(state.remaining)) return false;
  if (!["", "warning", "danger"].includes(state.alert)) return false;
  if (typeof state.overtime !== "boolean" || typeof state.showSeconds !== "boolean") {
    return false;
  }
  if (!isFiniteNumber(state.warningSeconds) || state.warningSeconds < 0) return false;
  if (!Array.isArray(state.laps) || state.laps.length > 1_000) return false;
  if (!state.laps.every(isStopwatchLap)) return false;
  if (typeof state.projecting !== "boolean") return false;
  return Number.isSafeInteger(state.seq) && state.seq >= 0;
}

module.exports = {
  isPlainObject,
  isFiniteNumber,
  isStopwatchLap,
  isMediaState,
  isStopwatchState,
};
