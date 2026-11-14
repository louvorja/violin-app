"use strict";
const fs = require("fs-extra");
const path = require("node:path");

function absolute(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") && path.isAbsolute(value);
}
function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function overlaps(a, b) {
  a = normalized(a); b = normalized(b);
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}
function canonical(value) {
  if (!absolute(value)) throw new Error("Escolha um caminho absoluto para a pasta.");
  let parent = path.resolve(value);
  const rest = [];
  while (!fs.existsSync(parent)) {
    // existsSync não reconhece links quebrados; não os trate como pastas novas.
    try {
      if (fs.lstatSync(parent).isSymbolicLink()) throw new Error(`A pasta contém um link indisponível: ${parent}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    rest.unshift(path.basename(parent));
    const next = path.dirname(parent);
    if (next === parent) throw new Error("O volume escolhido não está disponível.");
    parent = next;
  }
  return path.join(fs.realpathSync(parent), ...rest);
}
function validateRoots(mediaDir, videosDir, { profileDir, programDir, legacyRoot } = {}) {
  const roots = [canonical(mediaDir), canonical(videosDir)];
  // Versões antigas guardavam musics/images/covers ao lado de Videos. Só essa
  // disposição conhecida é preservada; novas escolhas exigem raízes separadas.
  const legacyNested = legacyRoot && normalized(roots[0]) === normalized(canonical(legacyRoot))
    && normalized(roots[1]) === normalized(canonical(path.join(legacyRoot, "Videos")));
  if (overlaps(...roots) && !legacyNested) throw new Error("Acervo e vídeos precisam de pastas separadas, sem uma dentro da outra.");
  const protectedRoots = [profileDir, programDir].filter(Boolean).map(canonical);
  for (const root of roots) {
    if (root === path.parse(root).root || protectedRoots.some((p) => overlaps(root, p))) {
      throw new Error("Escolha uma pasta própria para a mídia, fora dos arquivos do programa e do perfil do usuário.");
    }
  }
  return roots;
}
module.exports = { absolute, normalized, overlaps, canonical, validateRoots };
