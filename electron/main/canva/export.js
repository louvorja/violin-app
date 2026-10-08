"use strict";

/**
 * export.js — Leva o design do Canva para o disco como PDF, para projetar
 * localmente.
 *
 * É o caminho do FreeShow, adaptado ao que o LouvorJA já tem: o FreeShow
 * exporta PNG por página e monta um show próprio; nós exportamos UM PDF e
 * projetamos pelo `FileProjection` que já existe — tela cheia, setas, operador
 * e tela de retorno vêm de graça, e não depende de nenhum gesto do Canva.
 *
 * O preço é de tipo: animação, vídeo e transição do design viram página
 * parada. Por isso isto é uma OPÇÃO na tela de Integrações, não o único
 * caminho.
 *
 * Cache: `<dados>/canva/<designId>.pdf` + `.json` com o `updated_at` do
 * design. Editou no Canva → o timestamp muda → o PDF local é considerado velho
 * e exportamos de novo. Sem isso, o operador projetaria uma versão antiga sem
 * perceber.
 */

const fs = require("fs-extra");
const path = require("path");
const paths = require("../paths.js");
const api = require("./api.js");
const auth = require("./auth.js");

/** Escopo que os dois endpoints do export exigem (POST e GET /v1/exports). */
const EXPORT_SCOPE = "design:content:read";

/** O Canva marca o job a cada segundo; 60 tentativas = teto de 1 minuto. */
const POLL_MS = 1000;
const MAX_TENTATIVAS = 60;
/*
 * Download é arquivo, não API: 30 s derrubavam um deck grande em conexão lenta
 * no meio do culto. E é teto de fronteira — a URL vem da API, mas nada garante
 * o tamanho, e um arquivo gigante não tem lugar nenhum para onde ir.
 */
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_PDF_BYTES = 200 * 1024 * 1024;

function pastaCanva() {
  return path.join(paths.dataDir(), "canva");
}

/** Design id é `[A-Za-z0-9_-]`, mas não confiamos nisso para nome de arquivo. */
function nomeSeguro(designId) {
  return String(designId).replace(/[^A-Za-z0-9_-]/g, "_");
}

function alvosDoDesign(designId) {
  const base = nomeSeguro(designId);
  return {
    pdf: path.join(pastaCanva(), `${base}.pdf`),
    meta: path.join(pastaCanva(), `${base}.json`),
  };
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function falha(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function lerMeta(metaPath) {
  try {
    return fs.readJsonSync(metaPath);
  } catch (_) {
    return null;
  }
}

/**
 * O job falhou porque a saída `pro` não está disponível para este design.
 *
 * O código é o da própria documentação (`license_required`); a mensagem fica
 * como rede de segurança, porque o Canva já mudou o formato do erro uma vez.
 * Só faz sentido quando foi pedido `pro` — em `regular` não há o que reprocessar.
 */
function _eRecusaDeQualidade(estado) {
  const err = estado && estado.error;
  if (!err) return false;
  if (err.code === "license_required") return true;
  return typeof err.message === "string" && /licen[cs]e|premium/i.test(err.message);
}

/**
 * Cria o job e faz o poll até ele terminar.
 *
 * Devolve o ESTADO FINAL (inclusive `failed`) em vez de lançar: quem decide o
 * que fazer com uma falha é o chamador — no caso de `pro`, tentar de novo em
 * `regular`. Só o timeout lança, porque ele não tem nada a reprocessar.
 *
 * @param {string} designId
 * @param {"regular"|"pro"} qualidade
 * @param {{pollMs?: number, maxTentativas?: number}} opts
 * @returns {Promise<{status: string, urls: string[], error?: {code?: string, message?: string}}|null>}
 */
async function _rodarJob(designId, qualidade, opts) {
  const pollMs = opts.pollMs ?? POLL_MS;
  const maxTentativas = opts.maxTentativas ?? MAX_TENTATIVAS;
  const jobId = await api.criarExportPdf(designId, qualidade);
  const inicio = Date.now();
  let estado = null;

  for (let i = 0; i < maxTentativas; i++) {
    await dormir(pollMs);
    estado = await api.statusExport(jobId);
    if (estado.status === "success" || estado.status === "failed") return estado;
    if (Date.now() - inicio > 60_000) {
      throw falha("export_timeout", "A exportação do Canva demorou mais de 1 minuto.");
    }
  }
  return estado;
}

/**
 * Baixa o PDF e confirma que É um PDF antes de gravar.
 *
 * A URL de export devolve o arquivo como está; se o Canva responder uma página
 * de erro em HTML, gravar assim e projetar depois daria um canvas em branco na
 * frente da congregação. O `%PDF-` é a checagem de fronteira.
 */
async function baixar(url, destino) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    throw falha("download_failed", `Não baixei o PDF: ${err?.message || err}`);
  }
  if (!res.ok) {
    throw falha(`download_${res.status}`, `O Canva recusou o download (${res.status}).`);
  }

  /* Teto antes de buffer: o CDN quase sempre manda Content-Length. */
  const declarado = Number(res.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_PDF_BYTES) {
    throw falha("download_too_big", `O PDF veio com ${(declarado / 1048576).toFixed(0)} MB (teto 200).`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) {
    throw falha("download_too_big", `O PDF veio com ${(buf.length / 1048576).toFixed(0)} MB (teto 200).`);
  }

  const cabecalho = buf.subarray(0, 5).toString("latin1");
  if (cabecalho !== "%PDF-") {
    throw falha(
      "download_not_pdf",
      "O arquivo que veio do Canva não é um PDF — nada foi salvo."
    );
  }
  await fs.outputFile(destino, buf);
  return buf.length;
}

/**
 * Exporta um design como PDF e devolve o caminho local.
 *
 * @param {string} designId
 * @param {{pollMs?: number, maxTentativas?: number}} [opts] só para teste
 * @returns {Promise<{ok: true, path: string, cached: boolean, title: string,
 *                    pageCount: number, bytes?: number}>}
 * @throws {Error} com `.code` quando algo falha (`invalid_id`, `export_failed`,
 *   `export_timeout`, `export_shape`, `download_*`, `canva_*`, `network`)
 */
async function exportarPdf(designId, opts = {}) {
  const pollMs = opts.pollMs ?? POLL_MS;
  const maxTentativas = opts.maxTentativas ?? MAX_TENTATIVAS;
  const design = await api.getDesign(designId);
  const alvos = alvosDoDesign(design.id);
  await fs.ensureDir(pastaCanva());

  /*
   * Qualidade pedida neste clique. `regular` é o default e o único que
   * funciona em qualquer conta; `pro` é a saída premium e pode ser recusada
   * pelo Canva (ver o fallback lá embaixo). Ela entra na validade do cache:
   * trocar de `regular` para `pro` não pode continuar servindo o PDF velho.
   */
  const qualidadePedida = opts.exportQuality === "pro" ? "pro" : "regular";

  /* Cache: mesmo `updated_at` e arquivo no lugar = nada a exportar.
     `updatedAt > 0`: sem esse campo o cache nunca invalidaria — guardaria um
     PDF eterno de um design que o operador continua editando. */
  const meta = lerMeta(alvos.meta);
  if (
    design.updatedAt > 0 &&
    meta &&
    meta.updatedAt === design.updatedAt &&
    meta.exportQuality === qualidadePedida &&
    (await fs.pathExists(alvos.pdf))
  ) {
    return {
      ok: true,
      path: alvos.pdf,
      cached: true,
      title: design.title,
      pageCount: design.pageCount,
      quality: meta.qualityUsed || qualidadePedida,
    };
  }

  /*
   * Escopo conferido ANTES de criar o job, e só quando não há cache: um PDF
   * já no disco não gasta export nenhum. O 403 do Canva viria depois de um
   * poll de até 1 minuto e com uma mensagem crua que não diz o que fazer.
   *
   * `=== false` de propósito: `null` significa que o token não declarou
   * `scope`, e aí quem manda é o Canva — não bloqueamos um token válido por
   * engano.
   */
  if (auth.temEscopo(EXPORT_SCOPE) === false) {
    throw falha(
      "missing_scope",
      "Este token não tem o escopo design:content:read. Marque design:content (Read) no portal e reconecte o Canva: escopo só entra numa nova autorização."
    );
  }

  const primeira = await _rodarJob(design.id, qualidadePedida, opts);
  let estado = primeira;
  let qualidadeUsada = qualidadePedida;
  let qualityFallback = false;

  /*
   * Recusa da saída premium → refaz em `regular`.
   *
   * É a recomendação da própria documentação do Canva para
   * `license_required`: o design tem elemento premium que a conta não pagou.
   * Preferimos entregar um PDF em vez de nada — mas avisamos, porque o
   * operador pediu `pro` e recebeu outra coisa.
   */
  if (estado && estado.status === "failed" && qualidadePedida === "pro" && _eRecusaDeQualidade(estado)) {
    console.info(
      `[canva] export em pro recusado (${estado.error?.code || estado.error?.message}); refazendo em regular`
    );
    estado = await _rodarJob(design.id, "regular", opts);
    qualidadeUsada = "regular";
    qualityFallback = true;
  }

  if (estado && estado.status === "failed") {
    throw falha(
      "export_failed",
      estado.error?.message || "O Canva não conseguiu exportar este design."
    );
  }
  if (!estado || estado.status !== "success") {
    throw falha("export_timeout", "A exportação do Canva não terminou.");
  }
  /*
   * PDF é UM arquivo. Se o Canva devolver mais (comportamento que a documentação
   * descreve por página), falhar aqui é melhor do que projetar só a primeira
   * página e ninguém perceber.
   */
  if (estado.urls.length !== 1) {
    throw falha(
      "export_shape",
      `O Canva devolveu ${estado.urls.length} arquivos para um PDF; esperava 1.`
    );
  }

  const bytes = await baixar(estado.urls[0], alvos.pdf);
  await fs.outputJson(alvos.meta, {
    updatedAt: design.updatedAt,
    title: design.title,
    pageCount: design.pageCount,
    /* A pedida, não a usada: é ela que decide a validade do cache. */
    exportQuality: qualidadePedida,
    qualityUsed: qualidadeUsada,
    exportedAt: Date.now(),
  });

  return {
    ok: true,
    path: alvos.pdf,
    cached: false,
    title: design.title,
    pageCount: design.pageCount,
    quality: qualidadeUsada,
    qualityFallback,
    bytes,
  };
}

/**
 * PDFs já guardados: designId → `updated_at` do meta.
 *
 * Só entra o que existe DUAS vezes (`.pdf` + `.json`): um download que morreu
 * no meio deixa o meta órfão, e meta sem arquivo não é cache de nada — o
 * `exportarPdf` já exige os dois para servir do disco.
 *
 * A chave é o basename do arquivo, que para um id do Canva (`[A-Za-z0-9_-]`) é
 * o próprio id. Se um dia divergir, o selo some (fail-safe), nunca aparece onde
 * não deve.
 *
 * @returns {Promise<Record<string, number>>}
 */
async function listarCachePdf() {
  const mapa = {};
  let nomes = [];
  try {
    nomes = await fs.readdir(pastaCanva());
  } catch (_) {
    return mapa;
  }
  for (const nome of nomes) {
    if (!nome.endsWith(".json")) continue;
    const base = nome.slice(0, -".json".length);
    const meta = lerMeta(path.join(pastaCanva(), nome));
    if (!meta || typeof meta.updatedAt !== "number") continue;
    if (!(await fs.pathExists(path.join(pastaCanva(), `${base}.pdf`)))) continue;
    mapa[base] = meta.updatedAt;
  }
  return mapa;
}

/**
 * Apaga o PDF guardado de UM design (e o meta junto).
 *
 * O id vem do renderer, e `alvosDoDesign` monta caminho de arquivo a partir
 * dele — então é validado AQUI também: um id malformado não pode virar remoção
 * fora da pasta do Canva. A validação na fronteira (IPC) é a primeira porta;
 * esta é a de defesa.
 *
 * @param {unknown} designId
 * @returns {Promise<{ok: true} | {ok: false, code: string, message: string}>}
 */
async function limparCachePdf(designId) {
  if (typeof designId !== "string" || !designId || designId.length > 100) {
    return { ok: false, code: "invalid_id", message: "Design sem identificador." };
  }
  const alvos = alvosDoDesign(designId);
  try {
    await fs.remove(alvos.pdf);
    await fs.remove(alvos.meta);
    return { ok: true };
  } catch (err) {
    return { ok: false, code: "cache_remove_failed", message: String(err?.message || err) };
  }
}

module.exports = {
  exportarPdf,
  listarCachePdf,
  limparCachePdf,
  baixar,
  alvosDoDesign,
  pastaCanva,
  EXPORT_SCOPE,
  POLL_MS,
  MAX_TENTATIVAS,
  MAX_PDF_BYTES,
};
