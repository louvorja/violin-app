/**
 * Arquivos .slja entregues pelo sistema operacional: duplo clique, "Abrir com",
 * arrastar sobre o ícone do app.
 *
 * Chegam por três caminhos, conforme a plataforma e o momento:
 *   - argv do próprio processo (Windows/Linux, app fechado);
 *   - argv de uma segunda instância (Windows/Linux, app já aberto);
 *   - evento `open-file` (macOS, nos dois casos — e antes do `ready`).
 *
 * Nenhum deles espera o renderer. O arquivo que abriu o app precisa esperar a
 * janela principal terminar de subir e ligar o listener; por isso a fila.
 */
const fs = require("fs");
const path = require("path");
const { fileURLToPath } = require("url");

const CHANNEL = "app:open-files";
const SLJA_RE = /\.slja$/i;

/**
 * Caminhos de .slja existentes numa lista de argumentos de linha de comando.
 *
 * O Linux entrega `file:///...` (o `%U` do .desktop passa URLs), o Windows e o
 * macOS entregam caminho puro, e um terminal pode entregar caminho relativo ao
 * diretório onde o comando rodou — não ao do app.
 *
 * @param {string[]} argv
 * @param {string} [cwd]
 * @returns {string[]} caminhos absolutos, sem repetição
 */
function extractSljaPaths(argv, cwd = process.cwd()) {
  const found = [];
  for (const arg of Array.isArray(argv) ? argv : []) {
    if (typeof arg !== "string" || arg.startsWith("-")) continue;

    let candidate = arg;
    if (/^file:\/\//i.test(candidate)) {
      try {
        candidate = fileURLToPath(candidate);
      } catch {
        continue;
      }
    }
    if (!SLJA_RE.test(candidate)) continue;

    const resolved = path.resolve(cwd, candidate);
    try {
      if (!fs.statSync(resolved).isFile()) continue;
    } catch {
      continue;
    }
    if (!found.includes(resolved)) found.push(resolved);
  }
  return found;
}

/**
 * Fila entre o sistema operacional e o renderer da janela principal.
 *
 * `ready` liga o destino e devolve o que ficou esperando, no mesmo passo: o que
 * chegar depois vai direto para o destino, então nada se perde nem se repete.
 */
function createQueue() {
  let pending = [];
  let target = null;

  return {
    push(paths) {
      if (!paths.length) return;
      if (target && target.isDestroyed()) target = null;
      if (target) target.send(CHANNEL, paths);
      else pending.push(...paths);
    },

    ready(webContents) {
      target = webContents;
      const queued = pending;
      pending = [];
      return queued;
    },

    /** O renderer recarregou ou a janela fechou: volta a acumular. */
    reset() {
      target = null;
    },
  };
}

module.exports = { CHANNEL, extractSljaPaths, createQueue };
