"use strict";
const path = require("path");
const { variantsOf } = require("./mediaVariants.js");

/**
 * mediaRoots — de onde o app pode LER mídia, e como um caminho do banco vira
 * caminho em cada uma dessas origens.
 *
 * Puro: só `path`, sem tocar o disco. Quem testa existência é o mediaResolver.
 * A separação não é purismo — é o que torna o mapeamento testável, já que as
 * specs do processo principal rodam sem mock de `fs` nem de `electron`.
 */

/**
 * A versão clássica em Delphi guarda o mesmo acervo com outros nomes de pasta,
 * e sem separar por idioma: a instalação inteira é PT ou ES.
 */
const CLASSIC_FOLDERS = [
  ["covers/", "capas/"],
  ["images/", "imagens/"],
];

/**
 * Converte um caminho do banco para o lugar equivalente na pasta clássica.
 *
 * @param {string} rel  ex.: "musics/pt/Album/Faixa.opus"
 * @param {string|null} lang  idioma da instalação clássica ("pt" | "es")
 * @returns {string|null} caminho na estrutura antiga, ou null se não existe lá
 */
function toClassicRel(rel, lang) {
  const limpo = String(rel || "").replace(/^\/+/, "");
  if (!limpo) return null;

  for (const [novo, antigo] of CLASSIC_FOLDERS) {
    if (limpo.startsWith(novo)) return antigo + limpo.slice(novo.length);
  }

  // Sem idioma não dá para mapear música: `musicas/` do clássico atende um só,
  // e adivinhar serviria arquivo de outro idioma com o mesmo nome de faixa.
  if (lang) {
    const prefixo = `musics/${lang}/`;
    if (limpo.startsWith(prefixo)) return "musicas/" + limpo.slice(prefixo.length);
  }

  return null;
}

function _dentroDe(abs, dir) {
  const normAbs = path.resolve(abs);
  const normDir = path.resolve(dir);
  return normAbs === normDir || normAbs.startsWith(normDir + path.sep);
}

/**
 * Junta `dir` com um caminho vindo do banco, recusando o que escaparia da
 * pasta. Um "../" no catálogo não pode virar acesso ao disco inteiro — e o
 * mesmo cálculo decide onde é seguro gravar.
 *
 * @param {string} dir  raiz absoluta
 * @param {string} rel  caminho relativo, com ou sem barra inicial
 * @returns {string|null} absoluto, ou null se escapar
 */
function joinDentroDe(dir, rel) {
  const limpo = String(rel || "").replace(/^\/+/, "");
  if (!limpo || !dir) return null;
  const abs = path.resolve(dir, limpo);
  return _dentroDe(abs, dir) ? abs : null;
}

/**
 * `..` como segmento do caminho, com `/` ou `\`. Quem sobe de pasta é recusado;
 * o mesmo trecho dentro de um nome, como em "Aleluia...mp3", é arquivo legítimo.
 *
 * @param {string} caminho
 * @returns {boolean}
 */
function temSegmentoPai(caminho) {
  return String(caminho).split(/[\\/]/).some((segmento) => segmento === "..");
}

/**
 * Todos os arquivos que podem satisfazer `rel`, em ordem de preferência: a raiz
 * primária antes das extras, e dentro de cada uma o formato pedido antes das
 * variantes equivalentes (.mp3 por .opus, .bmp por .jpg).
 *
 * @param {string} rel
 * @param {Array<{dir: string, layout?: "modern"|"classic", lang?: string|null, origin?: string}>} roots
 * @returns {Array<{path: string, origin: string}>}
 */
function candidatesFor(rel, roots = []) {
  const limpo = String(rel || "").replace(/^\/+/, "");
  const saida = [];
  if (!limpo) return saida;

  for (const root of roots) {
    if (!root || !root.dir) continue;

    const relNaRaiz =
      root.layout === "classic" ? toClassicRel(limpo, root.lang) : limpo;
    if (!relNaRaiz) continue;

    // Cada raiz responde só pelo que está dentro dela.
    const abs = joinDentroDe(root.dir, relNaRaiz);
    if (!abs) continue;

    const origem = root.origin || (root.layout === "classic" ? "classic" : "own");
    for (const variante of variantsOf(abs)) {
      saida.push({ path: variante, origin: origem });
    }
  }

  return saida;
}

/**
 * Onde a versão clássica costuma estar instalada. Palpite para oferecer ao
 * usuário — nunca para ativar sozinho: fora do Windows ela vive dentro do
 * disco C emulado do Wine, em caminho que só o dono conhece.
 *
 * @param {{platform?: string, home?: string, env?: object}} options
 * @returns {string[]}
 */
function classicSearchDirs({ platform = process.platform, home = "", env = process.env } = {}) {
  if (platform === "win32") {
    const dirs = [
      "C:\\Program Files (x86)\\Louvor JA",
      "C:\\Program Files\\Louvor JA",
      "C:\\Program Files (x86)\\LouvorJA",
      "C:\\Program Files\\LouvorJA",
    ];
    // Não presumir a unidade C: — o instalador legado pode estar em outra
    // unidade e o Windows expõe os diretórios reais por estas variáveis.
    for (const base of [env?.ProgramFiles, env?.["ProgramFiles(x86)"]]) {
      if (!base) continue;
      for (const nome of ["Louvor JA", "LouvorJA"]) dirs.push(path.join(base, nome));
    }
    return [...new Set(dirs)];
  }

  if (!home) return [];

  const wine = [
    path.join(home, ".wine", "drive_c"),
    path.join(home, "Library", "Application Support", "CrossOver", "Bottles"),
  ];

  const saida = [];
  for (const base of wine) {
    saida.push(path.join(base, "Program Files (x86)", "Louvor JA"));
    saida.push(path.join(base, "Program Files", "Louvor JA"));
  }
  return saida;
}

/**
 * Um arquivo de 0 byte existe e não toca: é o resto de um download que morreu
 * no meio. O catálogo do servidor não informa tamanho, então `expectedSize`
 * chega 0 em todas as chamadas reais — sem esta regra, "tem o tamanho certo"
 * viraria só "existe".
 *
 * @param {number} actualSize
 * @param {number} [expectedSize]  0 quando o catálogo não informa
 * @returns {boolean}
 */
function isSizeAcceptable(actualSize, expectedSize = 0) {
  return expectedSize === 0 ? actualSize > 0 : actualSize >= expectedSize;
}

module.exports = {
  toClassicRel,
  isSizeAcceptable,
  candidatesFor,
  classicSearchDirs,
  joinDentroDe,
  temSegmentoPai,
  CLASSIC_FOLDERS,
};
