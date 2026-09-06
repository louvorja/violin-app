"use strict";

/**
 * monitorConfig.js — Leitura e resolução das preferências de monitor (v2).
 *
 * Faz a ponte entre o formato persistido (`user_data.options.displays`) e os
 * monitores conectados. Recebe `userData` e `connected` por parâmetro em vez de
 * importá-los, para continuar testável sem subir o Electron.
 */

const monitorIdentity = require("./monitorIdentityBridge.cjs");
const {
  SCHEMA_VERSION,
  buildConfig,
  hashSource,
  needsMigration,
  reconcilePending,
} = require("./migrations/monitorPrefsV2.js");

/**
 * Status possíveis da resolução de um papel:
 *  - resolved   monitor identificado com confiança
 *  - inferred   deduzido (único candidato plausível); usar, mas avisar
 *  - pending    preferência salva cujo monitor ainda não reapareceu
 *  - ambiguous  mais de um candidato igualmente provável
 *  - none       o usuário não escolheu monitor para este papel
 */
const STATUS = {
  RESOLVED: "resolved",
  INFERRED: "inferred",
  PENDING: "pending",
  AMBIGUOUS: "ambiguous",
  NONE: "none",
};

/** Lê o bloco v2, ou null se ainda não existe. */
function getConfig(userData) {
  const conf = userData && userData.options && userData.options.displays;
  return conf && conf.schema_version === SCHEMA_VERSION ? conf : null;
}

function _ensurePath(userData) {
  if (!userData.options) userData.options = {};
  if (!userData.options.displays) userData.options.displays = {};
  return userData.options.displays;
}

/**
 * Roda a migração v1 → v2 se necessário, mutando `userData`.
 *
 * Fail-open: qualquer erro deixa o formato antigo intacto e devolve
 * `changed: false`, para nunca derrubar o boot por causa disso.
 *
 * @returns {{changed: boolean, stats: object|null, error: Error|null}}
 */
function migrateIfNeeded({ userData, prefs, connected }) {
  try {
    const current = userData && userData.options && userData.options.displays;
    if (!needsMigration(current, prefs)) return { changed: false, stats: null, error: null };

    const { config, stats } = buildConfig({ prefs, userData, connected });
    const target = _ensurePath(userData);

    // Preserva as chaves legadas: `monitor_prefs` continua intacto no disco e
    // estes campos seguem lidos por quem ainda não migrou. Rollback continua
    // possível instalando um build antigo.
    Object.assign(target, config);
    return { changed: true, stats, error: null };
  } catch (error) {
    return { changed: false, stats: null, error };
  }
}

/**
 * Promove papéis pendentes cujo monitor reapareceu, mutando `userData`.
 * @returns {{changed: boolean, promoted: string[]}}
 */
function reconcile({ userData, connected }) {
  const config = getConfig(userData);
  if (!config) return { changed: false, promoted: [] };

  const { roles, promoted } = reconcilePending(config.roles, connected);
  if (promoted.length === 0) return { changed: false, promoted: [] };

  config.roles = roles;
  return { changed: true, promoted };
}

/**
 * Único candidato plausível para uma projeção: um monitor externo, que não é o
 * principal (onde o operador trabalha).
 */
function _soleExternalCandidate(connected, operatorDisplay) {
  const candidates = (connected || []).filter(
    (d) =>
      !d.primary &&
      d.internal !== true &&
      !(operatorDisplay && d.id === operatorDisplay.id)
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * A tela onde o operador trabalha está sendo posta no lugar do monitor que
 * sumiu?
 *
 * Com o projetor desconectado sobra um candidato só — a tela do operador — e
 * ela se parece o bastante com o que estava guardado para passar no limiar:
 * medido em 0,639 contra 0,6 com dois monitores parecidos, e 0,897 com dois
 * idênticos. O papel voltava "resolvido", sem aviso, e a letra da música abria
 * em cima do trabalho do operador no meio do culto.
 *
 * O que separa esse caso do espelhamento — onde o sistema reporta um monitor
 * só, que é ao mesmo tempo a tela do operador e o projetor, e projetar nele é
 * exatamente o que a igreja quer — é a POSIÇÃO. No espelhamento o monitor
 * guardado é o que está lá, na mesma origem. Aqui o guardado estava em outro
 * lugar, e o app está substituindo por falta de opção.
 *
 * Então: a tela do operador continua valendo quando é o mesmo lugar de sempre,
 * e nunca como substituta.
 */
function _substituiTelaDoOperador({ role, display, saved, candidate, operatorDisplay }) {
  if (role === monitorIdentity.roles().ROLES.OPERATOR) return false;
  if (!operatorDisplay || !display || display.id !== operatorDisplay.id) return false;
  return !monitorIdentity.get().sameSlot(saved, candidate);
}

/**
 * Resolve o monitor de um papel.
 *
 * Nunca cai no monitor principal para papéis de projeção: devolver a tela do
 * operador quando a preferência não resolve é exatamente o que faz a letra da
 * música aparecer na frente da congregação. Quem precisa de uma janela a
 * qualquer custo trata `status` e decide.
 *
 * @returns {{status: string, display: object|null, reason: string|null}}
 */
function resolveRole({ userData, role, connected, operatorDisplay }) {
  const config = getConfig(userData);
  if (!config || config.use_legacy_resolver) {
    return { status: STATUS.NONE, display: null, reason: "no-v2-config" };
  }

  const entry = config.roles && config.roles[role];
  if (!entry || entry.state === "none") {
    return { status: STATUS.NONE, display: null, reason: null };
  }

  const list = connected || [];
  const candidates = list.map((d, i) => monitorIdentity.get().identityFromDisplay(d, i));

  if (entry.state === "resolved" && entry.identity) {
    const match = monitorIdentity.get().matchIdentity(entry.identity, candidates);
    if (match.status === "resolved") {
      const index = candidates.indexOf(match.candidate);
      const display = list[index];
      if (
        _substituiTelaDoOperador({
          role,
          display,
          saved: entry.identity,
          candidate: candidates[index],
          operatorDisplay,
        })
      ) {
        return { status: STATUS.PENDING, display: null, reason: "operator-screen" };
      }
      return { status: STATUS.RESOLVED, display, reason: null };
    }
    if (match.status === "ambiguous") {
      return { status: STATUS.AMBIGUOUS, display: null, reason: "twin-monitors" };
    }
  }

  // Pendente, ou salvo mas desaparecido. Se só existe um monitor externo, ele é
  // quase certamente o projetor — usamos, mas sinalizamos para a UI avisar.
  if (role !== monitorIdentity.roles().ROLES.OPERATOR) {
    const sole = _soleExternalCandidate(list, operatorDisplay);
    if (sole) return { status: STATUS.INFERRED, display: sole, reason: "sole-external" };
  }

  // Chegou aqui com o papel configurado ("resolved" ou "pending") mas sem
  // monitor à altura. É diferente de "none" (nunca configurado): a UI precisa
  // dizer ao operador que o monitor DELE sumiu, não que falta configurar.
  return { status: STATUS.PENDING, display: null, reason: "monitor-absent" };
}

/**
 * Papel que uma feature usa.
 *
 * A escolha explícita do usuário vence; sem ela, vale o padrão do módulo
 * (bíblia projeta, relógio vai para o retorno, etc.).
 *
 * @returns {string|null} papel, ou null para "mesma janela"/desconhecida
 */
function featureRole(userData, feature) {
  const config = getConfig(userData);
  const chosen = config && config.features ? config.features[feature] : undefined;
  if (chosen === "" || chosen === null) return null; // "mesma janela", explícito
  if (chosen && Object.values(monitorIdentity.roles().ROLES).includes(chosen)) return chosen;
  return monitorIdentity.roles().roleOfFeature(feature);
}

/**
 * Define qual papel uma feature usa, mutando `userData`.
 * @param {string|null} role  null/"" = mesma janela
 */
function setFeatureRole({ userData, feature, role }) {
  const target = _ensurePath(userData);
  if (target.schema_version !== SCHEMA_VERSION) return false;
  if (!target.features) target.features = {};

  if (!role) target.features[feature] = "";
  else if (Object.values(monitorIdentity.roles().ROLES).includes(role)) target.features[feature] = role;
  else return false;
  return true;
}

/** Resolve o monitor de uma feature, pelo papel dela. */
function resolveFeature({ userData, feature, connected, operatorDisplay }) {
  const role = featureRole(userData, feature);
  if (!role) {
    // Distingue "o usuário escolheu mesma janela" de "essa feature não existe",
    // que são bugs bem diferentes de diagnosticar.
    const known = monitorIdentity.roles().roleOfFeature(feature) != null;
    return {
      status: STATUS.NONE,
      display: null,
      reason: known ? "no-role" : "unknown-feature",
      role: null,
    };
  }
  return { ...resolveRole({ userData, role, connected, operatorDisplay }), role };
}

/**
 * Estado de cada papel, para a UI mostrar o que está configurado e avisar
 * quando um monitor sumiu ou ficou ambíguo.
 */
function rolesSummary({ userData, connected, operatorDisplay }) {
  return Object.values(monitorIdentity.roles().ROLES).map((role) => {
    const resolved = resolveRole({ userData, role, connected, operatorDisplay });
    return {
      role,
      status: resolved.status,
      reason: resolved.reason,
      displayId: resolved.display ? resolved.display.id : null,
    };
  });
}

/**
 * Aponta um papel para um monitor, mutando `userData`.
 * @returns {boolean} true se algo mudou
 */
function setRoleDisplay({ userData, role, display, connected }) {
  const target = _ensurePath(userData);
  if (target.schema_version !== SCHEMA_VERSION) return false;
  if (!target.roles) target.roles = {};

  if (!display) {
    target.roles[role] = { state: "none", identity: null, legacy: null };
    return true;
  }
  const index = (connected || []).findIndex((d) => d.id === display.id);
  target.roles[role] = {
    state: "resolved",
    identity: monitorIdentity.get().identityFromDisplay(display, index === -1 ? null : index),
    legacy: null,
  };
  return true;
}

module.exports = {
  STATUS,
  SCHEMA_VERSION,
  hashSource,
  getConfig,
  migrateIfNeeded,
  reconcile,
  resolveRole,
  resolveFeature,
  featureRole,
  setFeatureRole,
  rolesSummary,
  setRoleDisplay,
};
