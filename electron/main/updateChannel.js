"use strict";

const fs = require("fs-extra");
const path = require("path");

const FILE = "update-channel.json";

/** `2.0.0-beta.18`, `2.0.0-rc.1`… — qualquer identificador depois do hífen. */
function isPrerelease(version) {
  return /^\d+\.\d+\.\d+-/.test(String(version || "").trim().replace(/^v/, ""));
}

/**
 * Se esta execução busca pré-versões.
 *
 * Ao chegar numa versão estável vindo de uma pré-versão (ou sem registro da
 * anterior), desliga: quem quiser continuar nas betas liga de novo. Sem isso,
 * quem testou uma beta seguiria recebendo versões instáveis sem saber. Sem
 * escolha salva, acompanha o tipo da versão instalada.
 *
 * @returns {{ useBeta: boolean, persist: boolean }} `persist` quando o valor salvo precisa mudar
 */
function resolveUseBeta({ currentVersion, lastRunVersion, saved }) {
  const arrivedAtStable =
    !isPrerelease(currentVersion) && (!lastRunVersion || isPrerelease(lastRunVersion));
  const useBeta = arrivedAtStable
    ? false
    : typeof saved === "boolean"
      ? saved
      : isPrerelease(currentVersion);
  return { useBeta, persist: saved !== useBeta };
}

function readLastRunVersion(dir) {
  try {
    const value = fs.readJsonSync(path.join(dir, FILE))?.lastRunVersion;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeLastRunVersion(dir, version) {
  try {
    fs.outputJsonSync(path.join(dir, FILE), { lastRunVersion: version });
  } catch (error) {
    console.warn("[updateChannel] não gravou a versão executada:", error?.message || error);
  }
}

module.exports = { isPrerelease, resolveUseBeta, readLastRunVersion, writeLastRunVersion, FILE };
