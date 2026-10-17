"use strict";

const os = require("node:os");
const { open } = require("node:fs/promises");
const MAX_RELEASE_BYTES = 16_384;

function safeRead(read) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function boundedText(value, pattern, limit = 128) {
  return typeof value === "string" && value.length <= limit && pattern.test(value)
    ? value
    : undefined;
}

/** Lê apenas identificadores conhecidos. Nunca interpreta o arquivo como shell. */
function parseOsRelease(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_RELEASE_BYTES) return {};
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^(ID|NAME|PRETTY_NAME|VERSION_ID)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      if (!value.endsWith(value[0]) || value.length < 2) continue;
      value = value.slice(1, -1).replace(/\\([\\"'$`])/g, "$1");
    }
    fields[match[1]] = value;
  }
  return {
    id: boundedText(fields.ID, /^[a-z0-9._-]+$/, 64),
    name: boundedText(fields.PRETTY_NAME || fields.NAME, /^[\p{L}\p{N} ._()+/-]+$/u),
    version: boundedText(fields.VERSION_ID, /^[a-zA-Z0-9._-]+$/, 64),
  };
}

async function readReleaseFile(path) {
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) return undefined;
    const bytes = Buffer.alloc(MAX_RELEASE_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_RELEASE_BYTES) return undefined;
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

/** @returns {Promise<import('../../src/types/TelemetryEnvironment').DesktopSystemInfo | undefined>} */
async function collectSystemInfo({
  processInfo = process,
  osInfo = os,
  readRelease = readReleaseFile,
} = {}) {
  const platform = processInfo.platform;
  if (!["darwin", "win32", "linux"].includes(platform)) return undefined;
  const result = {
    platform,
    processArch: boundedText(
      processInfo.arch,
      /^(?:arm|arm64|ia32|x64|riscv64|ppc64|s390x|loong64|mips|mipsel)$/
    ),
    kernelRelease: boundedText(
      safeRead(() => osInfo.release()),
      /^[a-zA-Z0-9._+-]+$/
    ),
  };
  if (platform === "linux") {
    // /etc tem precedência; não misturamos dados de duas distribuições.
    for (const path of ["/etc/os-release", "/usr/lib/os-release"]) {
      try {
        const text = await readRelease(path);
        if (typeof text !== "string") continue;
        result.linux = { ...parseOsRelease(text), source: path };
        break;
      } catch {
        /* distribuição sem os-release: preserva somente o kernel */
      }
    }
  } else {
    // No Linux getSystemVersion() seria o kernel, não a versão da distribuição.
    result.systemVersion = boundedText(
      safeRead(() => processInfo.getSystemVersion()),
      /^\d{1,6}(?:\.\d{1,6}){1,3}$/
    );
    if (platform === "win32") {
      // libuv distingue Windows 10/11 e preserva as edições Windows Server.
      result.windowsName = boundedText(
        safeRead(() => osInfo.version()),
        /^Windows [a-zA-Z0-9 .()+-]+$/
      );
    }
  }
  return result;
}

module.exports = { collectSystemInfo, parseOsRelease };
