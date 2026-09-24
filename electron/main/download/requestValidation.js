"use strict";

const path = require("node:path");

const MAX_FILES = 20_000;
const MAX_PATH_LENGTH = 2_048;
const MAX_URL_LENGTH = 4_096;
const MAX_TOTAL_CHARS = 4_000_000;
const MAX_EXPECTED_SIZE = 1_000_000_000_000;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function invalid(message) {
  throw new TypeError(`download files: ${message}`);
}

/**
 * A URL vem de dados de catálogo. Somente a base de arquivos configurada e
 * origens explicitamente confiáveis podem receber o token de download.
 * Este módulo é puro: o chamador fornece a raiz e as origens confiáveis.
 */
function parseTrustedBase(value, label, { allowQuery = false } = {}) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > MAX_URL_LENGTH) {
    invalid(`${label} inválida`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid(`${label} inválida`);
  }
  if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password ||
      (!allowQuery && url.search) || url.hash) {
    invalid(`${label} inválida`);
  }
  return url;
}

function safeMediaPath(value, label, { leadingSlash = false } = {}) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    CONTROL_CHARS.test(value) ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes(":") ||
    (leadingSlash && !value.startsWith("/"))
  ) {
    invalid(`${label} inválido`);
  }
  const segments = value.replace(/^\//, "").split("/");
  if (segments.some((segment) => {
    if (!segment || segment === "." || segment === ".." || segment.endsWith(".") || segment.endsWith(" ")) return true;
    // resolveMediaReference já decodifica o catálogo. Uma sequência %HH aqui
    // pode virar separador ou '..' depois de outra camada de decode no servidor.
    return /%[0-9a-f]{2}/i.test(segment);
  })) {
    invalid(`${label} inválido`);
  }
  return segments.join("/");
}

function validateLocal(local, expectedRelative, filesDir) {
  if (typeof local !== "string" || !local || local.length > MAX_PATH_LENGTH || CONTROL_CHARS.test(local)) {
    invalid("local inválido");
  }
  if (local.split(/[\\/]/).includes("..")) invalid("local inválido");
  if (local.includes("\\") && !path.isAbsolute(local)) invalid("local inválido");
  let relative = local;
  if (path.isAbsolute(local)) {
    const root = path.resolve(filesDir);
    relative = path.relative(root, path.resolve(local));
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      invalid("local fora da pasta de arquivos");
    }
    relative = relative.split(path.sep).join("/");
  }
  safeMediaPath(relative, "local");
  if (relative !== expectedRelative) invalid("local não corresponde a remote");
}

function safeUrlPath(value) {
  const authorityEnd = value.indexOf("/", value.indexOf("://") + 3);
  const rawPath = authorityEnd < 0 ? "/" : value.slice(authorityEnd).split(/[?#]/, 1)[0];
  for (const segment of rawPath.split("/")) {
    let decoded = segment;
    for (let i = 0; i < 8; i++) {
      // Depois da primeira decodificação, %25 pode ser um percentual literal
      // no nome do arquivo. Só decodifique novamente quando restar %HH;
      // decodeURIComponent("100% livre.jpg") não é uma segunda camada válida.
      if (i > 0 && !/%[0-9a-f]{2}/i.test(decoded)) break;
      let next;
      try {
        next = decodeURIComponent(decoded);
      } catch {
        invalid("remoteUrl inválida");
      }
      if (next === decoded) break;
      decoded = next;
      if (i === 7) invalid("remoteUrl inválida");
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || CONTROL_CHARS.test(decoded)) {
      invalid("remoteUrl contém caminho inseguro");
    }
  }
}

function validateRemoteUrl(value, remote, filesBaseUrl, allowedRemoteOrigins) {
  if (typeof value !== "string" || !value || value.length > MAX_URL_LENGTH) invalid("remoteUrl inválida");
  // HttpQueue escolhe o cliente HTTP com um startsWith sensível a maiúsculas.
  if (!/^https?:\/\//.test(value)) invalid("remoteUrl inválida");
  const url = parseTrustedBase(value, "remoteUrl", { allowQuery: true });
  safeUrlPath(value);
  const base = parseTrustedBase(filesBaseUrl, "filesBaseUrl");
  const allowed = new Set([base.origin]);
  if (allowedRemoteOrigins !== undefined) {
    if (!Array.isArray(allowedRemoteOrigins) || allowedRemoteOrigins.length > 16) {
      invalid("allowedRemoteOrigins inválida");
    }
    for (const origin of allowedRemoteOrigins) {
      const trusted = parseTrustedBase(origin, "allowedRemoteOrigins");
      if (trusted.href !== `${trusted.origin}/`) invalid("allowedRemoteOrigins inválida");
      allowed.add(trusted.origin);
    }
  }
  if (!allowed.has(url.origin)) invalid("remoteUrl usa origem não confiável");
  if (url.protocol !== "https:" && url.origin !== base.origin) invalid("remoteUrl exige HTTPS");

  let pathname;
  let basePath;
  try {
    pathname = decodeURIComponent(url.pathname);
    basePath = decodeURIComponent(base.pathname).replace(/\/+$/, "");
  } catch {
    invalid("remoteUrl inválida");
  }
  const fromBase = `${basePath}${remote}`;
  if (pathname !== fromBase && !(url.origin !== base.origin && pathname === remote)) {
    invalid("remoteUrl não corresponde a remote");
  }
}

/**
 * Valida o payload IPC e devolve apenas os campos aceitos. Lança TypeError
 * antes de qualquer operação de disco ou rede. `filesDir` é a raiz do acervo
 * moderno; caminhos absolutos legados são aceitos somente dentro dela.
 *
 * @param {unknown} files
 * @param {{ filesDir: string, filesBaseUrl?: string, allowedRemoteOrigins?: string[] }} options
 * @returns {Array<{ remote: string, local: string, remoteUrl?: string, expectedSize?: number }>}
 */
function validateDownloadEntries(files, { filesDir, filesBaseUrl, allowedRemoteOrigins } = {}) {
  if (typeof filesDir !== "string" || !path.isAbsolute(filesDir)) invalid("filesDir inválida");
  if (!Array.isArray(files) || files.length > MAX_FILES) invalid("lista inválida ou grande demais");
  const result = [];
  let totalChars = 0;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (!file || typeof file !== "object" || Array.isArray(file) || Object.getPrototypeOf(file) !== Object.prototype) {
      invalid(`entrada ${index} inválida`);
    }
    if (Object.keys(file).some((key) => !["remote", "local", "remoteUrl", "expectedSize"].includes(key))) {
      invalid(`campos da entrada ${index} inválidos`);
    }
    const remote = file.remote;
    const relative = safeMediaPath(remote, `remote da entrada ${index}`, { leadingSlash: true });
    validateLocal(file.local, relative, filesDir);
    const expectedSize = file.expectedSize;
    if (expectedSize !== undefined &&
      (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_EXPECTED_SIZE)) {
      invalid(`expectedSize da entrada ${index} inválido`);
    }
    const remoteUrl = file.remoteUrl;
    if (remoteUrl !== undefined) {
      validateRemoteUrl(remoteUrl, remote, filesBaseUrl, allowedRemoteOrigins);
    }
    totalChars += remote.length + file.local.length + (remoteUrl?.length || 0);
    if (totalChars > MAX_TOTAL_CHARS) invalid("payload grande demais");
    result.push({
      remote,
      local: file.local,
      ...(remoteUrl === undefined ? {} : { remoteUrl }),
      ...(expectedSize === undefined ? {} : { expectedSize }),
    });
  }
  return result;
}

module.exports = { validateDownloadEntries, MAX_FILES, MAX_PATH_LENGTH, MAX_URL_LENGTH, MAX_TOTAL_CHARS };
