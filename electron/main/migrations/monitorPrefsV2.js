"use strict";

/**
 * monitorPrefsV2.js — Migração das preferências de monitor para o formato v2.
 *
 * O formato v1 (`monitor_prefs`, um mapa feature → id) tinha três problemas:
 * o id do display não é estável entre reinícios, a mesma chave guardava três
 * tipos de valor diferentes, e as preferências viviam fora do `user_data` (sem
 * sincronização entre janelas nem backup).
 *
 * O v2 guarda um retrato do monitor por PAPEL, dentro de `user_data`.
 *
 * Princípio da migração: nunca descartar e nunca adivinhar. Preferência cujo
 * monitor não está conectado no momento (o usuário atualiza em casa, com o
 * projetor desligado) vira "pending" preservando o id original, e é promovida
 * quando aquele monitor reaparecer.
 *
 * Módulo PURO: sem `require("electron")`, sem I/O.
 */

const monitorIdentity = require("../monitorIdentityBridge.cjs");
const { resolveWantedId, rolesFromUserData } = require("../monitorPrefs.js");

const SCHEMA_VERSION = 2;

/** Hash estável e sem dependências, para detectar mudança na fonte. */
function hashSource(value) {
  const text = JSON.stringify(value === undefined ? null : value);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function _emptyRole() {
  return { state: "none", identity: null, legacy: null };
}

/**
 * Monta a entrada de um papel a partir de um id legado.
 * @param {number|null} id
 * @param {object[]} connected  displays conectados (objetos planos)
 */
function _roleEntry(id, connected) {
  if (id == null) return _emptyRole();

  const index = (connected || []).findIndex((d) => d.id === id);
  if (index === -1) {
    // Monitor ausente agora. Guardamos o id para promover mais tarde, em vez de
    // descartar (perderia a config) ou chutar outro monitor (projetaria errado).
    return { state: "pending", identity: null, legacy: { kind: "nativeId", id } };
  }
  return {
    state: "resolved",
    identity: monitorIdentity.get().identityFromDisplay(connected[index], index),
    legacy: null,
  };
}

/**
 * Constrói o bloco `options.displays` v2.
 *
 * @param {object} input
 * @param {Record<string, number|string|null>} input.prefs  monitor_prefs legado
 * @param {object} input.userData      user_data atual (para papéis primary/secondary)
 * @param {object[]} input.connected   displays conectados agora
 * @returns {{config: object, stats: object}}
 */
function buildConfig({ prefs, userData, connected }) {
  const legacyRoles = rolesFromUserData(userData);
  const resolve = (raw) => resolveWantedId(raw, legacyRoles);
  const { roles, divergent, unknown } = monitorIdentity.roles().deriveRoles(prefs, resolve);

  const config = {
    schema_version: SCHEMA_VERSION,
    roles: {
      [monitorIdentity.roles().ROLES.PROJECTION]: _roleEntry(roles[monitorIdentity.roles().ROLES.PROJECTION], connected),
      [monitorIdentity.roles().ROLES.STAGE]: _roleEntry(roles[monitorIdentity.roles().ROLES.STAGE], connected),
      [monitorIdentity.roles().ROLES.OPERATOR]: _roleEntry(roles[monitorIdentity.roles().ROLES.OPERATOR], connected),
    },
    legacy_features: divergent,
    legacy_unknown: unknown,
    use_legacy_resolver: false,
    source_hash: hashSource(prefs),
  };

  const stats = { resolved: 0, pending: 0, none: 0 };
  for (const entry of Object.values(config.roles)) stats[entry.state] += 1;

  return { config, stats };
}

/**
 * Promove papéis "pending" cujo monitor legado reapareceu.
 *
 * Roda no boot e a cada mudança de monitores: quem atualizou o app com o
 * projetor ligado é promovido na hora; quem atualizou em casa é promovido no
 * primeiro culto, sem precisar reconfigurar nada.
 *
 * @returns {{roles: object, promoted: string[]}} `roles` novo (sem mutar o original)
 */
function reconcilePending(rolesConfig, connected) {
  const next = {};
  const promoted = [];

  for (const [role, entry] of Object.entries(rolesConfig || {})) {
    const legacyId = entry && entry.state === "pending" && entry.legacy ? entry.legacy.id : null;
    if (legacyId == null) {
      next[role] = entry;
      continue;
    }
    const index = (connected || []).findIndex((d) => d.id === legacyId);
    if (index === -1) {
      next[role] = entry;
      continue;
    }
    next[role] = {
      state: "resolved",
      identity: monitorIdentity.get().identityFromDisplay(connected[index], index),
      legacy: null,
    };
    promoted.push(role);
  }

  return { roles: next, promoted };
}

/**
 * True se a migração precisa rodar.
 *
 * Idempotente por versão + hash da fonte: o hash faz a migração refazer o
 * trabalho caso um downgrade tenha escrito de novo no formato antigo.
 */
function needsMigration(currentConfig, prefs) {
  if (!currentConfig || currentConfig.schema_version !== SCHEMA_VERSION) return true;
  return currentConfig.source_hash !== hashSource(prefs);
}

module.exports = {
  SCHEMA_VERSION,
  hashSource,
  buildConfig,
  reconcilePending,
  needsMigration,
};
