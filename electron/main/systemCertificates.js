"use strict";

/**
 * Integra as raízes de confiança do Windows ao cliente HTTPS do Node.
 *
 * O Chromium/Electron já consulta o repositório de certificados do sistema,
 * mas o `https` do processo principal usa por padrão apenas as raízes Mozilla
 * embutidas no Node. Em redes de igreja/empresa, antivírus e proxies podem
 * instalar uma CA somente no Windows; downloads de mídia, catálogo e updater
 * então falham enquanto a mesma URL abre no navegador.
 *
 * Não desliga a validação TLS e não usa NODE_TLS_REJECT_UNAUTHORIZED=0:
 * apenas acrescenta certificados que o próprio Windows declarou confiáveis.
 */

function _certificates(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

/**
 * @param {{ platform?: string, tls?: object }} [options]
 * @returns {{ enabled: boolean, supported: boolean, defaultCount: number, systemCount: number, addedCount: number, error?: string }}
 */
function configureSystemCertificates({ platform = process.platform, tls = require("tls") } = {}) {
  const empty = {
    enabled: false,
    supported: false,
    defaultCount: 0,
    systemCount: 0,
    addedCount: 0,
  };
  if (platform !== "win32") return empty;

  if (
    !tls ||
    typeof tls.getCACertificates !== "function" ||
    typeof tls.setDefaultCACertificates !== "function"
  ) {
    return { ...empty, error: "runtime sem suporte ao repositório de certificados do sistema" };
  }

  try {
    const defaults = _certificates(tls.getCACertificates("default"));
    const system = _certificates(tls.getCACertificates("system"));
    const merged = [...defaults];
    const seen = new Set(defaults.map((certificate) => certificate.trim()));
    for (const certificate of system) {
      const normalized = certificate.trim();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(certificate);
    }

    if (merged.length > defaults.length) tls.setDefaultCACertificates(merged);
    return {
      enabled: true,
      supported: true,
      defaultCount: defaults.length,
      systemCount: system.length,
      addedCount: merged.length - defaults.length,
    };
  } catch (error) {
    return {
      ...empty,
      supported: true,
      error: String(error?.message || error),
    };
  }
}

module.exports = { configureSystemCertificates };
