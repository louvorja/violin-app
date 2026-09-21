"use strict";

const tls = require("tls");

/**
 * Certificados em que o Node confia ao falar com o YouTube: os embutidos mais os do sistema.
 * O navegador lê o repositório do sistema, mas o `https` do processo main só lê os embutidos, e
 * proxy ou antivírus que inspeciona o HTTPS instala a raiz só no sistema. O resultado é
 * "unable to get local issuer certificate" numa conexão que o navegador aceita.
 *
 * @param {(kind: "system" | "default") => string[]} [getCerts]
 * @returns {() => string[] | undefined} indefinido quando não há nada a somar aos padrões do Node
 */
function createSystemTrust(getCerts = (kind) => tls.getCACertificates(kind)) {
  let loaded = false;
  let certificates;
  return function trustedCertificates() {
    if (loaded) return certificates;
    loaded = true;
    try {
      const system = getCerts("system");
      if (Array.isArray(system) && system.length > 0) {
        certificates = [...new Set([...getCerts("default"), ...system])];
      }
    } catch {
      /* Node sem a API, ou sem acesso ao repositório: fica com os embutidos */
    }
    return certificates;
  };
}

module.exports = { createSystemTrust, trustedCertificates: createSystemTrust() };
