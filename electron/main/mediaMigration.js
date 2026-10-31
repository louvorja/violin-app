"use strict";

const fs = require("fs-extra");
const path = require("path");
const { DATA_ENTRIES } = require("./dataMigration.js");

// Tudo aqui é assíncrono de propósito: as origens incluem `Documents`, e no
// macOS a primeira leitura dela segura a chamada até o operador responder ao
// pedido de acesso. Uma chamada síncrona parava o processo principal inteiro —
// janela, projeções e IPC — enquanto o aviso estivesse na tela.

/**
 * O que, dentro de `dir`, conta como acervo a mudar de lugar. `files/` e
 * `storage/`, `library/` e `Videos/` ficam de fora porque são a estrutura nova: sem essa exceção a
 * própria pasta de dados, recém-criada com as preferências dentro, passaria
 * por origem de migração e encerraria a busca antes de olhar as outras.
 */
async function listLegacyMediaEntries(dir) {
  try {
    if (!(await fs.stat(dir)).isDirectory()) return [];
    return (await fs.readdir(dir)).filter((name) =>
      !DATA_ENTRIES.some((entry) => [entry, `${entry}.bak`, `${entry}.tmp`].includes(name)) && !name.startsWith(".")
    );
  } catch (_) {
    return [];
  }
}

async function hasContent(dir) {
  try {
    return (await fs.stat(dir)).isDirectory() && (await fs.readdir(dir)).length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Recolhe o acervo para `target` (`<dados>/files`).
 *
 * O acervo passou por três endereços — pasta escolhida à mão, `Documents/
 * LouvorJA Violin` solto na raiz e `<userData>/files` — e uma instalação
 * antiga pode ter parado em qualquer um deles. Move entrada por entrada, e
 * não a pasta inteira, porque no caso da raiz a origem é a própria pasta de
 * dados: mover ela para dentro de si mesma não existe.
 *
 * Move em vez de copiar: `fs.move` renomeia quando origem e destino estão no
 * mesmo volume, então gigabytes de MP3 mudam de lugar num piscar. Só o que
 * ainda não existe no destino é movido — a migração pode ser interrompida e
 * retomada no boot seguinte. Origem sem permissão de leitura conta como vazia.
 *
 * @returns {Promise<{ origem: string, movidos: number } | null>}
 */
async function migrateLegacyMedia(target, candidates) {
  if (await hasContent(target)) return null;
  for (const origem of candidates) {
    if (path.resolve(origem) === path.resolve(target)) continue;
    const entradas = await listLegacyMediaEntries(origem);
    if (!entradas.length) continue;

    await fs.ensureDir(target);
    let movidos = 0;
    for (const nome of entradas) {
      const dest = path.join(target, nome);
      if (await fs.pathExists(dest)) continue;
      await fs.move(path.join(origem, nome), dest);
      movidos++;
    }
    return { origem, movidos };
  }
  return null;
}

module.exports = { listLegacyMediaEntries, migrateLegacyMedia };
