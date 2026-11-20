"use strict";

/**
 * fileAccess.js — o que o renderer pode alcançar pelo IPC de arquivos.
 *
 * O renderer é a única coisa que conversa com esse IPC, mas ele mostra
 * conteúdo que veio de fora (programa da igreja, Playlists, arquivos de
 * mídia). Uma falha de XSS ali não pode virar "leia/renomeie/apague qualquer
 * arquivo do computador": só as raízes que o próprio operador escolheu (as
 * bibliotecas, o acervo, a pasta da igreja) ficam abertas.
 *
 * A checagem é sempre por caminho real (`fs.realpath`): um symlink para fora
 * da raiz é negado, e no Windows a comparação ignora maiúsculas/minúsculas.
 */

const fs = require("fs/promises");
const path = require("path");

/** O caminho real mesmo quando o arquivo ainda não existe (resolve o ancestral mais próximo). */
async function realPathDeep(target, P = path) {
  let current = P.resolve(target);
  const rest = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return P.join(real, ...rest.reverse());
    } catch {
      const parent = P.dirname(current);
      if (parent === current) return P.resolve(target);
      rest.push(P.basename(current));
      current = parent;
    }
  }
}

function createFileAccess({ platform = process.platform } = {}) {
  const windows = platform === "win32";
  /** O `path` do SO em que o app roda (o teste simula o Windows com `path.win32`). */
  const P = windows ? path.win32 : path;
  /** Raízes permitidas, já normalizadas. */
  const roots = new Set();

  const norm = (p) => {
    const resolved = P.resolve(p);
    return windows ? resolved.toLowerCase() : resolved;
  };

  /** Caminho absoluto utilizável em comparação. */
  function valid(p) {
    return typeof p === "string" && p.length > 0 && p.length < 4096 && !p.includes("\0") && P.isAbsolute(p);
  }

  /** Autoriza uma raiz (a escolha do operador ou uma pasta do próprio app). */
  async function allowRoot(root) {
    if (!valid(root)) return false;
    roots.add(norm(await realPathDeep(root, P)));
    return true;
  }

  /** O caminho está em alguma raiz permitida? `false` para qualquer entrada inválida. */
  async function isAllowed(target) {
    if (!valid(target)) return false;
    if (!roots.size) return false;
    const real = norm(await realPathDeep(target, P));
    for (const root of roots) {
      const rel = P.relative(root, real);
      const escapes = rel === ".." || rel.startsWith(`..${P.sep}`) || P.isAbsolute(rel);
      if (rel === "" || !escapes) return true;
    }
    return false;
  }

  /** Dois caminhos apontam para o mesmo lugar (a raiz configurada, por exemplo)? */
  async function isSamePath(a, b) {
    if (!valid(a) || !valid(b)) return false;
    return norm(await realPathDeep(a, P)) === norm(await realPathDeep(b, P));
  }

  return {
    allowRoot,
    isAllowed,
    isSamePath,
    /** Só para testes: esquece as raízes registradas. */
    clear() {
      roots.clear();
    },
  };
}

module.exports = {
  createFileAccess,
  ...createFileAccess(),
  realPathDeep,
};
