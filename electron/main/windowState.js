"use strict";

/**
 * windowState.js — Geometria das janelas COMUNS (não-fullscreen).
 *
 * Hoje só a tela do operador (`/operator`) é uma janela comum: as projeções
 * nascem em tela cheia e não têm tamanho do usuário. O estado é gravado em
 * `user_data` (`options.windows.<feature>`) e reaplicado na próxima abertura.
 *
 * Este módulo é puro: não conhece Electron, `user_data` nem `BrowserWindow`.
 * Recebe o estado cru (que veio do disco e não é confiável) e a lista de telas,
 * e devolve os bounds a usar. Toda a validação de fronteira mora aqui.
 */

/** Abaixo disto a janela é ilegível — melhor tratá-la como não salva. */
const LARGURA_MINIMA = 480;
const ALTURA_MINIMA = 360;

function _numero(valor) {
  return typeof valor === "number" && Number.isFinite(valor);
}

/** Retângulo utilizável de uma tela (área útil; fallback para os bounds). */
function _area(display) {
  const bruta = display && (display.workArea || display.bounds);
  if (!bruta) return null;
  if (!_numero(bruta.x) || !_numero(bruta.y) || !_numero(bruta.width) || !_numero(bruta.height)) {
    return null;
  }
  if (bruta.width <= 0 || bruta.height <= 0) return null;
  return bruta;
}

function _normalizarBounds(bruto) {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const { x, y, width, height } = bruto;
  if (!_numero(x) || !_numero(y) || !_numero(width) || !_numero(height)) return null;
  if (width < LARGURA_MINIMA || height < ALTURA_MINIMA) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * Normaliza o estado gravado. Qualquer campo inválido derruba o estado inteiro:
 * abrir com lixo de `setBounds` pode jogar a janela para fora da tela.
 *
 * @param {unknown} bruto
 * @returns {{ maximized: boolean, bounds: {x:number,y:number,width:number,height:number} | null } | null}
 */
function normalizarEstadoJanela(bruto) {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const maximized = bruto.maximized === true;
  const bounds = _normalizarBounds(bruto.bounds);
  if (!bounds && !maximized) return null;
  return { maximized, bounds };
}

/** Corta o retângulo para caber na área útil, mantendo o tamanho quando couber. */
function _clamp(bounds, area) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Mesmo tamanho, centralizado na área (para quando o monitor salvo sumiu). */
function _centralizado(bounds, area) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Área que contém o CENTRO do retângulo — a tela "dona" da janela. */
function _areaDoCentro(bounds, areas) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return (
    areas.find(
      (area) =>
        cx >= area.x && cx < area.x + area.width && cy >= area.y && cy < area.y + area.height
    ) || null
  );
}

/**
 * Como abrir uma janela comum.
 *
 * - sem estado legível → **maximizada** (primeira abertura; é o padrão pedido);
 * - estado maximizado → maximizada, criada nos bounds salvos para que
 *   "desmaximizar" volte ao tamanho/posição de antes;
 * - estado normal com a posição ainda numa tela conectada → restaura;
 * - estado normal cuja posição ficou órfã (monitor removido, resolução mudou)
 *   → mantém o tamanho, centralizado na tela de destino.
 *
 * @param {object} opcoes
 * @param {unknown} [opcoes.estado] Estado gravado (não confiável).
 * @param {object|null} [opcoes.displayDestino] Tela onde a janela deve nascer.
 * @param {object[]} [opcoes.displays] Telas conectadas.
 * @param {{x:number,y:number,width:number,height:number}|null} [opcoes.padrao] Bounds de primeira abertura.
 * @returns {{ maximized: boolean, bounds: object|null }}
 */
function resolverPosicaoJanela({ estado, displayDestino = null, displays = [], padrao = null } = {}) {
  const areas = (Array.isArray(displays) ? displays : []).map(_area).filter(Boolean);
  const destino = _area(displayDestino) || areas[0] || null;
  const salvo = normalizarEstadoJanela(estado);

  if (!salvo) {
    return { maximized: true, bounds: padrao ? { ...padrao } : null };
  }
  if (!salvo.bounds) {
    return { maximized: salvo.maximized, bounds: padrao ? { ...padrao } : null };
  }

  /* A posição só vale se o CENTRO dela ainda cair numa tela conectada. Um
   * canto encostado na borda pode estar um pixel fora e mesmo assim ser a
   * janela certa — por isso o centro, e não o retângulo inteiro. */
  const dona = _areaDoCentro(salvo.bounds, areas);
  const bounds = dona ? _clamp(salvo.bounds, dona) : destino ? _centralizado(salvo.bounds, destino) : salvo.bounds;
  return { maximized: salvo.maximized, bounds };
}

module.exports = {
  ALTURA_MINIMA,
  LARGURA_MINIMA,
  normalizarEstadoJanela,
  resolverPosicaoJanela,
};
