/** A page event belongs only to the file currently on stage. */
export function newFileProjectionId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function fileProjectionPageFor(
  payload: unknown,
  activePlaybackId: string | undefined
): { page: number; totalPages?: number; source?: "operator" | "projection" } | null {
  if (!activePlaybackId || !payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (value.playback_id !== activePlaybackId ||
      !Number.isSafeInteger(value.page) || (value.page as number) < 1) return null;
  if (value.totalPages !== undefined &&
      (!Number.isSafeInteger(value.totalPages) || (value.totalPages as number) < 1)) return null;
  if (value.source !== undefined && value.source !== "operator" && value.source !== "projection") return null;
  return {
    page: value.page as number,
    ...(value.totalPages === undefined ? {} : { totalPages: value.totalPages as number }),
    ...(value.source === undefined ? {} : { source: value.source as "operator" | "projection" }),
  };
}

export interface MovimentoPaginaPdf {
  /** Novo conteúdo do `LJ_FILE_PROJECTION` — igual ao anterior se não mudou nada. */
  storage: string;
  /** Comando a enviar, ou `null` quando a página não mudou (início/fim do documento). */
  comando: { playback_id: string; page: number; source: "operator" } | null;
}

/**
 * Avança/volta a página do PDF que está no telão, a partir do cache de reabertura.
 *
 * O `LJ_FILE_PROJECTION` é o documento compartilhado: é dele que a janela de
 * projeção retoma depois de fechar, e é nele que a página é escrita antes do
 * comando sair — assim quem reabrir cai na página certa mesmo sem ninguém
 * ouvindo.
 *
 * Pura de propósito: o Storage e o Broadcast ficam em quem chama (`useMedia`),
 * e o clamp de verdade é da janela de projeção, que é a única que sabe o
 * `numPages` do arquivo. Pressionar ← na página 1 devolve `comando: null` —
 * sem comando, mas também sem deixar a tecla cair nos slides de música: o PDF
 * é que manda no telão.
 *
 * @param bruto  conteúdo atual do `LJ_FILE_PROJECTION`, ou null
 * @param delta  +1 avança, -1 volta
 * @returns `null` quando não há PDF no palco (ou o cache está ilegível)
 */
export function moverPaginaPdf(
  bruto: string | null,
  delta: number
): MovimentoPaginaPdf | null {
  if (!bruto) return null;
  let payload: { type?: string; playback_id?: string; page?: number } | null;
  try {
    payload = JSON.parse(bruto) as { type?: string; playback_id?: string; page?: number } | null;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || payload.type !== "pdf" || !payload.playback_id) {
    return null;
  }

  const atual = typeof payload.page === "number" && payload.page > 0 ? payload.page : 1;
  const proxima = Math.max(1, atual + delta);
  if (proxima === atual) return { storage: bruto, comando: null };

  return {
    storage: JSON.stringify({ ...payload, page: proxima }),
    comando: { playback_id: payload.playback_id, page: proxima, source: "operator" },
  };
}

/** O que a lista de reprodução deve fazer quando um payload de arquivo chega. */
export type AdocaoProjecao =
  /**
   * `encerrada` distingue "a projeção de arquivo saiu de cena" de "outra
   * mídia assumiu o telão": só a primeira desfaz o `playback_id` da lista.
   */
  | { acao: "limpar"; encerrada: boolean }
  | { acao: "ignorar" }
  | {
      acao: "adotar";
      playback_id: string;
      title: string;
      page: number;
      declaredPageCount?: number;
    };

/**
 * Decide o que fazer com um payload do `FILE_PROJECTION` que chegou.
 *
 * Existem três casos e confundi-los tem custo alto: não limpar deixa a barra
 * do player acesa com o projetor apagado; adotar o nosso de novo vira loop;
 * não adotar o de fora deixa o operador sem como virar a página.
 *
 * - `limpar` — a projeção saiu de cena (`action: "clear"`) ou outra mídia
 *   assumiu o palco;
 * - `ignorar` — é o PDF que ESTA lista acabou de projetar (mesmo
 *   `playback_id`), ou o payload não é um arquivo projetável;
 * - `adotar` — um PDF veio de fora (aba Canva, liturgia) e é ele que está no
 *   telão agora.
 *
 * Pura de propósito: a decisão é testável sem montar a lista inteira.
 */
export function adotarProjecaoExterna(
  payload: unknown,
  playbackIdAtual: string | undefined
): AdocaoProjecao {
  if (!payload || typeof payload !== "object") return { acao: "limpar", encerrada: true };
  const data = payload as {
    action?: unknown;
    type?: unknown;
    playback_id?: unknown;
    title?: unknown;
    page?: unknown;
    pageCount?: unknown;
  };

  if (data.action === "clear") return { acao: "limpar", encerrada: true };
  if (data.type !== undefined && data.type !== "pdf") return { acao: "limpar", encerrada: false };
  if (data.type !== "pdf" || typeof data.playback_id !== "string" || !data.playback_id) {
    return { acao: "ignorar" };
  }
  if (data.playback_id === playbackIdAtual) return { acao: "ignorar" };

  return {
    acao: "adotar",
    playback_id: data.playback_id,
    title: typeof data.title === "string" ? data.title : "",
    page: typeof data.page === "number" && data.page > 0 ? data.page : 1,
    ...(typeof data.pageCount === "number" && data.pageCount > 0
      ? { declaredPageCount: data.pageCount }
      : {}),
  };
}
