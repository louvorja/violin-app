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
const { comPrazo } = require("./http.js");
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

/** Formatos de export que o desktop sabe baixar e conferir. */
const FORMATOS = {
  pdf: { ext: ".pdf", magic: "%PDF-", rotulo: "PDF" },
  jpg: { ext: ".jpg", magic: "\xff\xd8\xff", rotulo: "imagem JPG" },
  png: { ext: ".png", magic: "\x89PNG", rotulo: "imagem PNG" },
  gif: { ext: ".gif", magic: "GIF8", rotulo: "imagem GIF" },
};

function formatoDe(nome) {
  return FORMATOS[String(nome || "pdf").toLowerCase()] || FORMATOS.pdf;
}

function pastaCanva() {
  return path.join(paths.dataDir(), "canva");
}

/** Design id é `[A-Za-z0-9_-]`, mas não confiamos nisso para nome de arquivo. */
function nomeSeguro(designId) {
  return String(designId).replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * Alvos de UM design num formato: `<id>.<ext>` + meta `<id>.<ext>.json`.
 * O meta é por formato — PDF e JPG do mesmo design têm validades próprias.
 */
function alvosDoDesign(designId, formato = "pdf") {
  const spec = formatoDe(formato);
  const base = nomeSeguro(designId);
  return {
    arquivo: path.join(pastaCanva(), `${base}${spec.ext}`),
    meta: path.join(pastaCanva(), `${base}${spec.ext}.json`),
    ext: spec.ext,
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
 * @param {{formato?: string, exportQuality?: "regular"|"pro", pollMs?: number,
 *          maxTentativas?: number}} opts
 * @returns {Promise<{status: string, urls: string[], error?: {code?: string, message?: string}}|null>}
 */
async function _rodarJob(designId, opts = {}) {
  const pollMs = opts.pollMs ?? POLL_MS;
  const maxTentativas = opts.maxTentativas ?? MAX_TENTATIVAS;
  const nome = String(opts.formato || "pdf").toLowerCase();
  const jobId =
    nome === "pdf"
      ? await api.criarExportPdf(designId, opts.exportQuality)
      : await api.criarExport(designId, { type: nome });
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
 * Baixa o arquivo exportado e confere a assinatura do formato antes de gravar.
 *
 * A URL de export devolve o arquivo como está; se o Canva responder uma página
 * de erro em HTML, gravar assim e projetar depois daria uma tela em branco na
 * frente da congregação. A assinatura (`%PDF-`, `\xFF\xD8\xFF`…) é a checagem
 * de fronteira.
 *
 * @param {string} url
 * @param {string} destino
 * @param {string} [formato]
 */
async function baixar(url, destino, formato = "pdf") {
  const spec = formatoDe(formato);
  /*
   * O corpo é lido dentro do consumidor porque o teto por `Content-Length`
   * precisa vir ANTES de baixar o arquivo inteiro — e o helper cancela o corpo
   * quando o consumidor sai sem ler (status de erro, arquivo grande demais), em
   * vez de segurar a conexão até o GC.
   */
  let buf;
  try {
    buf = await comPrazo(url, {}, DOWNLOAD_TIMEOUT_MS, async (res) => {
      if (!res.ok) {
        throw Object.assign(new Error(`O Canva recusou o download (${res.status}).`), {
          code: `download_${res.status}`,
        });
      }

      /* Teto antes de buffer: o CDN quase sempre manda Content-Length. */
      const declarado = Number(res.headers.get("content-length"));
      if (Number.isFinite(declarado) && declarado > MAX_PDF_BYTES) {
        throw Object.assign(
          new Error(`O arquivo veio com ${(declarado / 1048576).toFixed(0)} MB (teto 200).`),
          { code: "download_too_big" }
        );
      }

      return Buffer.from(await res.arrayBuffer());
    });
  } catch (err) {
    /* Rede e prazo viram a mesma falha de download; o resto é do consumidor. */
    if (err?.code && String(err.code).startsWith("download_")) throw falha(err.code, err.message);
    throw falha("download_failed", `Não baixei o ${spec.rotulo}: ${err?.message || err}`);
  }

  if (buf.length > MAX_PDF_BYTES) {
    throw falha("download_too_big", `O arquivo veio com ${(buf.length / 1048576).toFixed(0)} MB (teto 200).`);
  }

  const cabecalho = buf.subarray(0, 5).toString("latin1");
  if (!cabecalho.startsWith(spec.magic)) {
    throw falha(
      `download_not_${spec.ext.replace(".", "")}`,
      `O arquivo que veio do Canva não é ${spec.rotulo} — nada foi salvo.`
    );
  }
  await fs.outputFile(destino, buf);
  return buf.length;
}

/**
/**
 * Exporta um design e devolve o caminho local — o coração compartilhado.
 *
 * @param {string} designId
 * @param {{formato?: "pdf"|"jpg"|"png"|"gif", exportQuality?: "regular"|"pro",
 *          pollMs?: number, maxTentativas?: number}} opts
 * @returns {Promise<{ok: true, path: string, cached: boolean, title: string,
 *                    formato: string, pageCount?: number, bytes?: number,
 *                    quality?: string, qualityFallback?: boolean}>}
 */
async function exportarMidia(designId, opts = {}) {
  const nome = String(opts.formato || "pdf").toLowerCase();
  const spec = formatoDe(nome);
  const design = await api.getDesign(designId);
  const alvos = alvosDoDesign(design.id, nome);
  await fs.ensureDir(pastaCanva());

  /*
   * Qualidade pedida neste clique. `regular` é o default e o único que
   * funciona em qualquer conta; `pro` é a saída premium e pode ser recusada
   * pelo Canva (ver o fallback lá embaixo). Ela entra na validade do cache:
   * trocar de `regular` para `pro` não pode continuar servindo o arquivo velho.
   * Só o PDF tem qualidade — imagem ignora.
   */
  const qualidadePedida = nome === "pdf" && opts.exportQuality === "pro" ? "pro" : "regular";

  /* Cache: mesmo `updated_at` e arquivo no lugar = nada a exportar.
     `updatedAt > 0`: sem esse campo o cache nunca invalidaria — guardaria um
     arquivo eterno de um design que o operador continua editando. */
  const meta = lerMeta(alvos.meta);
  if (
    design.updatedAt > 0 &&
    meta &&
    meta.updatedAt === design.updatedAt &&
    meta.exportQuality === qualidadePedida &&
    (await fs.pathExists(alvos.arquivo))
  ) {
    return {
      ok: true,
      path: alvos.arquivo,
      cached: true,
      title: design.title,
      formato: nome,
      pageCount: nome === "pdf" ? design.pageCount : undefined,
      quality: meta.qualityUsed || qualidadePedida,
    };
  }

  /*
   * Escopo conferido ANTES de criar o job, e só quando não há cache: um arquivo
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

  const primeira = await _rodarJob(design.id, { ...opts, formato: nome });
  let estado = primeira;
  let qualidadeUsada = qualidadePedida;
  let qualityFallback = false;

  /*
   * Recusa da saída premium → refaz em `regular`.
   *
   * É a recomendação da própria documentação do Canva para
   * `license_required`: o design tem elemento premium que a conta não pagou.
   * Preferimos entregar o arquivo em vez de nada — mas avisamos, porque o
   * operador pediu `pro` e recebeu outra coisa.
   */
  if (estado && estado.status === "failed" && qualidadePedida === "pro" && _eRecusaDeQualidade(estado)) {
    console.info(
      `[canva] export em pro recusado (${estado.error?.code || estado.error?.message}); refazendo em regular`
    );
    estado = await _rodarJob(design.id, { ...opts, formato: "pdf", exportQuality: "regular" });
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
   * UM arquivo por job. Se o Canva devolver mais (comportamento que a
   * documentação descreve por página), falhar aqui é melhor do que projetar
   * só a primeira página e ninguém perceber.
   */
  if (estado.urls.length !== 1) {
    throw falha(
      "export_shape",
      `O Canva devolveu ${estado.urls.length} arquivos para um ${spec.ext}; esperava 1.`
    );
  }

  const bytes = await baixar(estado.urls[0], alvos.arquivo, nome);
  await fs.outputJson(alvos.meta, {
    updatedAt: design.updatedAt,
    title: design.title,
    formato: nome,
    pageCount: design.pageCount,
    /* A pedida, não a usada: é ela que decide a validade do cache. */
    exportQuality: qualidadePedida,
    qualityUsed: qualidadeUsada,
    exportedAt: Date.now(),
  });

  return {
    ok: true,
    path: alvos.arquivo,
    cached: false,
    title: design.title,
    formato: nome,
    pageCount: nome === "pdf" ? design.pageCount : undefined,
    quality: qualidadeUsada,
    qualityFallback,
    bytes,
  };
}

/** Exporta como PDF (formato histórico do desktop). */
async function exportarPdf(designId, opts = {}) {
  return exportarMidia(designId, { ...opts, formato: "pdf" });
}

/**
 * Exporta como JPG — a imagem INTEIRA do design.
 *
 * A API do Canva não serve o binário do design: só thumbnail (~595 px, expira
 * em 15 min) e export. Para a Biblioteca de Mídia projetar uma imagem do Canva
 * sem ser a thumbnail, o caminho é este: um arquivo `.jpg` no cache, do mesmo
 * jeito que o PDF.
 */
async function exportarImg(designId, opts = {}) {
  return exportarMidia(designId, { ...opts, formato: "jpg" });
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
    // `<designId>.<ext>.json` → designId é o que vem antes da 1ª extensão.
    const base = nome.slice(0, -".json".length);
    const designId = base.split(".")[0];
    const meta = lerMeta(path.join(pastaCanva(), nome));
    if (!meta || typeof meta.updatedAt !== "number") continue;
    // O selo é do PDF: só entra quem tem o `.pdf` no lugar (`base` já é
    // `<designId>.<ext>` — o meta é `<designId>.<ext>.json`).
    if (!(await fs.pathExists(path.join(pastaCanva(), base)))) continue;
    mapa[designId] = meta.updatedAt;
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
  // Apaga TODAS as variantes do design (PDF, JPG, meta) — o cache é um só
  // conceito para o operador, ainda que sejam arquivos diferentes.
  const segura = nomeSeguro(designId);
  try {
    const alvos = [];
    for (const spec of Object.values(FORMATOS)) {
      alvos.push(path.join(pastaCanva(), `${segura}${spec.ext}`));
      alvos.push(path.join(pastaCanva(), `${segura}${spec.ext}.json`));
    }
    for (const alvo of alvos) {
      await fs.remove(alvo);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, code: "cache_remove_failed", message: String(err?.message || err) };
  }
}

/**
 * Apaga TODO o cache de PDF (os arquivos e os metas).
 *
 * É o que a troca de qualidade exige: `pro` e `regular` são arquivos
 * diferentes do mesmo design, e o cache leva a qualidade pedida na validade
 * (`exportarPdf`). Sem limpar, o selo continuaria aceso no card e o clique
 * serviria o PDF da qualidade antiga — o operador pediu Pro e veria Regular.
 *
 * Some com os metas órfãos também (json sem pdf): não são cache de nada, mas
 * também não têm para quem ficar.
 *
 * @returns {Promise<{ok: true, removidos: number} | {ok: false, code: string, message: string}>}
 */
async function limparTodoCachePdf() {
  let nomes = [];
  try {
    nomes = await fs.readdir(pastaCanva());
  } catch (_) {
    /* Pasta que não existe é cache vazio — não é erro. */
    return { ok: true, removidos: 0 };
  }
  const exts = Object.values(FORMATOS).map((spec) => spec.ext);
  const arquivos = nomes.filter(
    (nome) => exts.some((ext) => nome.endsWith(ext)) || nome.endsWith(".json")
  );
  try {
    for (const nome of arquivos) {
      await fs.remove(path.join(pastaCanva(), nome));
    }
  } catch (err) {
    return { ok: false, code: "cache_remove_failed", message: String(err?.message || err) };
  }
  /* Conta o que era mídia de verdade (não meta órfão). */
  return { ok: true, removidos: arquivos.filter((nome) => !nome.endsWith(".json")).length };
}

module.exports = {
  exportarPdf,
  exportarImg,
  exportarMidia,
  listarCachePdf,
  limparCachePdf,
  limparTodoCachePdf,
  baixar,
  alvosDoDesign,
  pastaCanva,
  EXPORT_SCOPE,
  POLL_MS,
  MAX_TENTATIVAS,
  MAX_PDF_BYTES,
};
