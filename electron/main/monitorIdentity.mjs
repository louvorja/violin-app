/**
 * monitorIdentity.cjs — Identidade estável de monitores.
 *
 * O `id` numérico de um display NÃO é estável: no Windows muda ao trocar porta
 * HDMI ou religar o projetor, no macOS muda com hubs USB-C, no Linux/X11 é
 * sequencial. Guardar só o id faz a preferência do usuário se perder, e o
 * fallback silencioso para o monitor principal joga a projeção na tela do
 * operador no meio do culto.
 *
 * A solução é guardar um retrato do monitor e reconciliá-lo por similaridade.
 *
 * Módulo PURO: sem dependências, sem I/O. Opera sobre objetos planos.
 *
 * ESM porque o renderer e o web/PWA o importam direto (o Vite não converte
 * CommonJS de arquivos do projeto em desenvolvimento). O main process, que é
 * CommonJS, chega aqui pela ponte em `monitorIdentityBridge.cjs`.
 */

/**
 * Peso de cada campo. A soma é 100, mas o denominador real é só o dos campos
 * comparáveis entre os dois lados — ver `scoreIdentity`.
 */
export const WEIGHTS = {
  /** Único campo com semântica de "qual aparelho" (vem do EDID). */
  label: 45,
  /** Identidade quando o label vem vazio (X11) ou genérico ("Generic PnP Monitor"). */
  px: 25,
  /** Painel de notebook nunca é projetor. */
  internal: 10,
  /** Mudar o DPI do sistema não troca o aparelho — peso baixo de propósito. */
  scaleFactor: 5,
  /** Desempate. Rearranjo de posição no SO é esperado, então vale pouco. */
  nativeOrigin: 5,
  /** Desempate. */
  index: 5,
  /** Desempate. Baixo porque no Windows o id é reciclado entre monitores. */
  nativeId: 3,
  /** Ruído. */
  rotation: 2,
};

/** Crédito parcial quando a resolução mudou mas o formato da tela não. */
export const ASPECT_ONLY_POINTS = 8;

/**
 * Score mínimo para aceitar uma correspondência, e vantagem mínima sobre o
 * segundo colocado.
 *
 * ARBITRÁRIOS: calibrados apenas contra a suíte de cenários em
 * `__tests__/monitorIdentity.spec.js`. A expectativa é ajustá-los com dados de
 * campo — por isso são constantes exportadas, e não literais no meio do código.
 */
export const ACCEPT_THRESHOLD = 0.6;
export const MARGIN = 0.1;

/** Identidade vazia — schema fixo, todos os campos sempre presentes. */
export function emptyIdentity() {
  return {
    source: null,
    label: "",
    px: null,
    dip: null,
    scaleFactor: null,
    rotation: null,
    internal: null,
    nativeOrigin: null,
    index: null,
    primary: null,
    nativeId: null,
  };
}

/**
 * Constrói a identidade a partir de um `Electron.Display`.
 *
 * `px` usa a resolução física (bounds × scaleFactor) porque o `scaleFactor`
 * muda quando o usuário altera o zoom do Windows sem trocar de monitor.
 *
 * @param {object} display  Objeto plano no formato de Electron.Display
 * @param {number} index    Posição em getAllDisplays()
 * @returns {object} identidade com schema fixo
 */
export function identityFromDisplay(display, index) {
  const d = display || {};
  const bounds = d.bounds || {};
  const scale = typeof d.scaleFactor === "number" ? d.scaleFactor : 1;
  const w = typeof bounds.width === "number" ? bounds.width : null;
  const h = typeof bounds.height === "number" ? bounds.height : null;

  return {
    ...emptyIdentity(),
    source: "electron",
    label: typeof d.label === "string" ? d.label.trim() : "",
    px: w != null && h != null ? { w: Math.round(w * scale), h: Math.round(h * scale) } : null,
    dip: w != null && h != null ? { w, h } : null,
    scaleFactor: typeof d.scaleFactor === "number" ? d.scaleFactor : null,
    rotation: typeof d.rotation === "number" ? d.rotation : null,
    internal: typeof d.internal === "boolean" ? d.internal : null,
    nativeOrigin: d.nativeOrigin
      ? { x: d.nativeOrigin.x, y: d.nativeOrigin.y }
      : bounds.x != null && bounds.y != null
        ? { x: bounds.x, y: bounds.y }
        : null,
    index: typeof index === "number" ? index : null,
    primary: typeof d.primary === "boolean" ? d.primary : null,
    nativeId: typeof d.id === "number" ? d.id : null,
  };
}

function _sameSize(a, b) {
  return !!a && !!b && a.w === b.w && a.h === b.h;
}

function _sameAspect(a, b) {
  if (!a || !b || !a.h || !b.h) return false;
  return Math.abs(a.w / a.h - b.w / b.h) < 0.01;
}

function _samePoint(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

/**
 * Rejeições categóricas, aplicadas antes de pontuar.
 * @returns {string|null} motivo do veto, ou null
 */
export function vetoReason(saved, candidate) {
  if (
    typeof saved.internal === "boolean" &&
    typeof candidate.internal === "boolean" &&
    saved.internal !== candidate.internal
  ) {
    return "internal-mismatch";
  }

  const bothLabeled = !!saved.label && !!candidate.label;
  if (bothLabeled && saved.label !== candidate.label && !_sameSize(saved.px, candidate.px)) {
    return "label-and-size-mismatch";
  }

  // Fingerprints de plataformas diferentes não são comparáveis: as unidades de
  // `px` e `nativeOrigin` no web não equivalem às do Electron.
  if (saved.source && candidate.source && saved.source !== candidate.source) {
    return "source-mismatch";
  }

  return null;
}

/**
 * Pontua a semelhança entre uma identidade salva e um candidato conectado.
 *
 * Só entram no denominador os campos comparáveis nos dois lados — assim um
 * `label` vazio (Linux/X11) sai da conta em vez de virar penalidade.
 *
 * @returns {{score: number, veto: string|null, available: number, earned: number}}
 */
export function scoreIdentity(saved, candidate) {
  const veto = vetoReason(saved, candidate);
  if (veto) return { score: 0, veto, available: 0, earned: 0 };

  let available = 0;
  let earned = 0;

  if (saved.label && candidate.label) {
    available += WEIGHTS.label;
    if (saved.label === candidate.label) earned += WEIGHTS.label;
  }

  if (saved.px && candidate.px) {
    available += WEIGHTS.px;
    if (_sameSize(saved.px, candidate.px)) earned += WEIGHTS.px;
    else if (_sameAspect(saved.px, candidate.px)) earned += ASPECT_ONLY_POINTS;
  }

  if (typeof saved.internal === "boolean" && typeof candidate.internal === "boolean") {
    available += WEIGHTS.internal;
    if (saved.internal === candidate.internal) earned += WEIGHTS.internal;
  }

  if (typeof saved.scaleFactor === "number" && typeof candidate.scaleFactor === "number") {
    available += WEIGHTS.scaleFactor;
    if (saved.scaleFactor === candidate.scaleFactor) earned += WEIGHTS.scaleFactor;
  }

  if (saved.nativeOrigin && candidate.nativeOrigin) {
    available += WEIGHTS.nativeOrigin;
    if (_samePoint(saved.nativeOrigin, candidate.nativeOrigin)) earned += WEIGHTS.nativeOrigin;
  }

  if (typeof saved.index === "number" && typeof candidate.index === "number") {
    available += WEIGHTS.index;
    if (saved.index === candidate.index) earned += WEIGHTS.index;
  }

  if (typeof saved.nativeId === "number" && typeof candidate.nativeId === "number") {
    available += WEIGHTS.nativeId;
    if (saved.nativeId === candidate.nativeId) earned += WEIGHTS.nativeId;
  }

  if (typeof saved.rotation === "number" && typeof candidate.rotation === "number") {
    available += WEIGHTS.rotation;
    if (saved.rotation === candidate.rotation) earned += WEIGHTS.rotation;
  }

  return {
    score: available === 0 ? 0 : earned / available,
    veto: null,
    available,
    earned,
  };
}

/**
 * Desempata dois candidatos com score idêntico para a mesma identidade.
 * @returns {number} negativo se `a` é melhor, positivo se `b` é melhor, 0 se empatam
 */
function _tiebreak(saved, a, b) {
  const rank = (c) =>
    (saved.nativeId != null && c.nativeId === saved.nativeId ? 4 : 0) +
    (_samePoint(saved.nativeOrigin, c.nativeOrigin) ? 2 : 0) +
    (saved.index != null && c.index === saved.index ? 1 : 0);
  return rank(b) - rank(a);
}

/**
 * Reconcilia várias identidades salvas contra os monitores conectados.
 *
 * Resolve EM LOTE, não uma a uma: dois projetores do mesmo modelo (cenário real
 * em igrejas) são indistinguíveis campo a campo, e resolver isoladamente faria
 * as duas preferências colapsarem no mesmo monitor.
 *
 * @param {Record<string, object>} savedByKey  identidades salvas, por chave
 * @param {object[]} candidates                identidades dos monitores conectados
 * @returns {Record<string, {status: string, candidate: object|null, score: number}>}
 *          status: "resolved" | "ambiguous" | "unmatched"
 */
export function matchIdentities(savedByKey, candidates) {
  const keys = Object.keys(savedByKey || {});
  const result = {};
  const taken = new Set();

  const scores = new Map();
  for (const key of keys) {
    const saved = savedByKey[key];
    const row = (candidates || [])
      .map((candidate) => ({ candidate, ...scoreIdentity(saved, candidate) }))
      .filter((entry) => !entry.veto && entry.score >= ACCEPT_THRESHOLD)
      .sort((a, b) => b.score - a.score || _tiebreak(saved, a.candidate, b.candidate));
    scores.set(key, row);
    result[key] = { status: "unmatched", candidate: null, score: 0 };
  }

  const pending = new Set(keys);
  while (pending.size > 0) {
    // Melhor par global ainda disponível.
    let best = null;
    for (const key of pending) {
      const row = scores.get(key).filter((entry) => !taken.has(entry.candidate));
      if (row.length === 0) {
        result[key] = { status: "unmatched", candidate: null, score: 0 };
        pending.delete(key);
        continue;
      }
      if (!best || row[0].score > best.entry.score) best = { key, entry: row[0], row };
    }
    if (!best) break;

    const { key, entry, row } = best;
    const runnerUp = row[1];
    const ambiguous =
      runnerUp &&
      entry.score - runnerUp.score < MARGIN &&
      _tiebreak(savedByKey[key], entry.candidate, runnerUp.candidate) === 0;

    if (ambiguous) {
      result[key] = { status: "ambiguous", candidate: null, score: entry.score };
    } else {
      result[key] = { status: "resolved", candidate: entry.candidate, score: entry.score };
      taken.add(entry.candidate);
    }
    pending.delete(key);
  }

  return result;
}

/** Reconcilia uma única identidade. Atalho sobre `matchIdentities`. */
export function matchIdentity(saved, candidates) {
  return matchIdentities({ _: saved }, candidates)._;
}

