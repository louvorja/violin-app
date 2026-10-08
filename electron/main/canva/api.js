"use strict";

/**
 * api.js — Chamadas REST do Canva, sempre a partir do main.
 *
 * Nada disto roda no renderer: além de CORS/CSP, o access token jamais pode
 * chegar no renderer (a CSP nem libera `connect-src` para api.canva.com — ver
 * `config/cspDomains.cjs`).
 *
 * As respostas passam por normalizadores PUROS antes de sair daqui: o que a
 * Canva muda num campo não vira `undefined` na tela do operador, e item
 * malformado é descartado em vez de renderizado pela metade.
 */

const auth = require("./auth.js");

const BASE = "https://api.canva.com/rest/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_LIMIT = 100;
const MAX_NAME = 200;

/* -------------------------------------------------------------------------- */
/*  Validação de fronteira                                                     */
/* -------------------------------------------------------------------------- */

function str(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.length > MAX_NAME ? trimmed.slice(0, MAX_NAME) : trimmed;
}

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Só URL https — thumbnail vira `img src`, jamais javascript:. */
function https(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch (_) {
    return null;
  }
}

function thumbOf(raw) {
  return https(raw?.thumbnail?.url);
}

/**
 * Item de pasta no formato que o renderer entende.
 * @param {unknown} raw
 * @returns {{type: "folder"|"design"|"image", id: string, name: string,
 *            thumb: string|null, url?: string, pageCount?: number} | null}
 */
function normalizeFolderItem(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (raw.type === "folder" && raw.folder && typeof raw.folder.id === "string") {
    return {
      type: "folder",
      id: raw.folder.id,
      name: str(raw.folder.name, "Pasta sem nome"),
      thumb: thumbOf(raw.folder),
    };
  }

  if (raw.type === "design" && raw.design && typeof raw.design.id === "string") {
    return {
      type: "design",
      id: raw.design.id,
      name: str(raw.design.title, "Design sem título"),
      thumb: thumbOf(raw.design),
      pageCount: int(raw.design.page_count, 0),
    };
  }

  if (raw.type === "image" && raw.image && typeof raw.image.id === "string") {
    /*
     * Asset não tem view_url pública: quem abre é o próprio thumbnail.
     * É a menor resolução que o Canva entrega — documentado como limite.
     */
    return {
      type: "image",
      id: raw.image.id,
      name: str(raw.image.name, "Imagem"),
      thumb: thumbOf(raw.image),
      url: thumbOf(raw.image),
    };
  }

  return null;
}

/**
 * Design vindo de `/designs` (lista) — sem `urls`, que expiram.
 * @param {unknown} raw
 * @returns {{type: "design", id: string, name: string, thumb: string|null,
 *            pageCount: number} | null}
 */
function normalizeDesign(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
  return {
    type: "design",
    id: raw.id,
    name: str(raw.title, "Design sem título"),
    thumb: thumbOf(raw),
    pageCount: int(raw.page_count, 0),
  };
}

/** Itens malformados saem da lista; `items` nunca vem `undefined`. */
function normalizeItems(raw, normalizer) {
  const list = Array.isArray(raw) ? raw : [];
  const items = [];
  for (const entry of list) {
    const item = normalizer(entry);
    if (item) items.push(item);
  }
  return items;
}

function continuationOf(raw) {
  return typeof raw?.continuation === "string" && raw.continuation ? raw.continuation : null;
}

function ownedOwnership(value) {
  return value === "any" || value === "owned" || value === "shared" ? value : "any";
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return MAX_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

/* -------------------------------------------------------------------------- */
/*  Transporte                                                                 */
/* -------------------------------------------------------------------------- */

async function _get(path, params = {}) {
  const token = await auth.getAccessToken();
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    /* Só primitivo entra na query: um objeto vindo do renderer vira lixo. */
    if (typeof value !== "string" && typeof value !== "number") continue;
    if (value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const falha = new Error(`Sem resposta do Canva: ${err?.message || err}`);
    falha.code = "network";
    throw falha;
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const falha = new Error(json?.message || json?.error || `Erro ${res.status} do Canva.`);
    falha.code = "canva_" + res.status;
    falha.status = res.status;
    throw falha;
  }
  return json || {};
}

/* -------------------------------------------------------------------------- */
/*  Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Conteúdo de uma pasta. `folderId` indefinido = raiz ("Projetos").
 * @param {{folderId?: string, continuation?: string|null, limit?: number}} [opts]
 */
async function listFolderItems(opts = {}) {
  const folderId = str(opts.folderId, "root") || "root";
  const json = await _get(`/folders/${encodeURIComponent(folderId)}/items`, {
    item_types: "design,folder,image",
    sort_by: "title_ascending",
    limit: clampLimit(opts.limit),
    continuation: opts.continuation || undefined,
  });
  return { items: normalizeItems(json.items, normalizeFolderItem), continuation: continuationOf(json) };
}

/**
 * Designs da conta: `any` (meus + compartilhados), `owned` ou `shared`.
 * @param {{ownership?: string, query?: string, continuation?: string|null, limit?: number}} [opts]
 */
async function listDesigns(opts = {}) {
  const json = await _get("/designs", {
    ownership: ownedOwnership(opts.ownership),
    sort_by: "modified_descending",
    limit: clampLimit(opts.limit),
    query: opts.query ? str(opts.query) : undefined,
    continuation: opts.continuation || undefined,
  });
  return {
    items: normalizeItems(json.items || json.designs, normalizeDesign),
    continuation: continuationOf(json),
  };
}

/**
 * Metadados de UM design — é daqui que sai o `view_url`.
 *
 * Sempre fresco: o `urls` do Canva é temporário (JWT com `expwy`), então usar o
 * da lista abriria um link já vencido depois de o operador deixar a aba parada.
 *
 * @param {string} designId
 * @returns {Promise<{url: string}>}
 */
async function getDesignViewUrl(designId) {
  const id = str(designId);
  if (!id) {
    const err = new Error("Design sem identificador.");
    err.code = "invalid_id";
    throw err;
  }
  const json = await _get(`/designs/${encodeURIComponent(id)}`);
  const url = https(json?.design?.urls?.view_url);
  if (!url) {
    const err = new Error("O Canva não devolveu um link de visualização.");
    err.code = "no_view_url";
    throw err;
  }
  return { url };
}

/** Nome da conta conectada — para a tela de Integrações dizer quem entrou. */
async function getProfile() {
  const json = await _get("/users/me/profile");
  return { name: str(json?.profile?.display_name) };
}

/**
 * Metadados de um design — é o `updated_at` que muda a chave do cache de
 * export: se o operador editou no Canva, o PDF local fica velho sozinho.
 *
 * @param {string} designId
 * @returns {Promise<{id: string, title: string, updatedAt: number, pageCount: number}>}
 */
async function getDesign(designId) {
  const id = str(designId);
  if (!id) {
    const err = new Error("Design sem identificador.");
    err.code = "invalid_id";
    throw err;
  }
  const json = await _get(`/designs/${encodeURIComponent(id)}`);
  const d = json?.design;
  if (!d || typeof d.id !== "string") {
    const err = new Error("Design não encontrado.");
    err.code = "design_not_found";
    throw err;
  }
  return {
    id: d.id,
    title: str(d.title, "Design"),
    updatedAt: int(d.updated_at),
    pageCount: int(d.page_count),
  };
}

/**
 * Cria o job de export em PDF.
 *
 * Requer o escopo `design:content:read` (não é o mesmo que `design:meta:read`).
 * Rate limit do Canva: 75 exports / 5 min e 500 / 24 h por usuário — um
 * design por culto, com cache local, fica muito abaixo disso.
 *
 * `export_quality` é pedido explicitamente porque a API, sem ele, assume
 * `regular`. `"pro"` é a saída premium e pode ser recusada quando o design tem
 * elemento premium não pago — quem trata isso é o `export.js` (fallback).
 *
 * @param {string} designId
 * @param {"regular"|"pro"} [exportQuality]
 * @returns {Promise<string>} id do job
 */
async function criarExportPdf(designId, exportQuality = "regular") {
  const token = await auth.getAccessToken();
  const qualidade = exportQuality === "pro" ? "pro" : "regular";
  const body = JSON.stringify({
    design_id: str(designId),
    format: { type: "pdf", export_quality: qualidade },
  });

  let res;
  try {
    res = await fetch(`${BASE}/exports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const falha = new Error(`Sem resposta do Canva: ${err?.message || err}`);
    falha.code = "network";
    throw falha;
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const falha = new Error(json?.message || json?.error || `Erro ${res.status} do Canva.`);
    falha.code = "canva_" + res.status;
    throw falha;
  }
  const jobId = json?.job?.id;
  if (typeof jobId !== "string" || !jobId) {
    const err = new Error("O Canva não devolveu um job de export.");
    err.code = "export_no_job";
    throw err;
  }
  return jobId;
}

/**
 * Estado do job de export.
 * @param {string} jobId
 * @returns {Promise<{status: string, urls: string[], error?: {message?: string}}>}
 */
async function statusExport(jobId) {
  const token = await auth.getAccessToken();
  const id = str(jobId);
  if (!id) {
    const err = new Error("Job de export sem identificador.");
    err.code = "invalid_id";
    throw err;
  }

  let res;
  try {
    res = await fetch(`${BASE}/exports/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const falha = new Error(`Sem resposta do Canva: ${err?.message || err}`);
    falha.code = "network";
    throw falha;
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const falha = new Error(json?.message || json?.error || `Erro ${res.status} do Canva.`);
    falha.code = "canva_" + res.status;
    throw falha;
  }
  const job = json?.job || {};
  return {
    status: str(job.status, "in_progress"),
    urls: Array.isArray(job.urls) ? job.urls.filter((u) => typeof u === "string") : [],
    error: job.error && typeof job.error === "object" ? job.error : undefined,
  };
}

module.exports = {
  BASE,
  listFolderItems,
  listDesigns,
  getDesignViewUrl,
  getDesign,
  criarExportPdf,
  statusExport,
  getProfile,
  normalizeFolderItem,
  normalizeDesign,
  normalizeItems,
  continuationOf,
  clampLimit,
  ownedOwnership,
  str,
  int,
  https,
};
