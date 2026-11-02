/**
 * PowerPoint na Biblioteca de Mídia.
 *
 * O .pptx não é projetado direto: o processo main instala as fontes que faltam
 * e o próprio PowerPoint (ou o LibreOffice) gera um PDF fiel. Daqui para a
 * frente o item é um PDF comum — a projeção de arquivo já o leva para o telão
 * e para o retorno.
 *
 * Funções puras (sem Vue) para poderem ser testadas sozinhas.
 */

/** Extensões de apresentação aceitas pela biblioteca. */
export const PPT_EXT = ["pptx", "ppsx", "pptm", "ppt", "pps", "odp"];

/** Valor do `accept` do `<input type="file">` para apresentações. */
export const PPT_ACCEPT = PPT_EXT.map((e) => "." + e).join(",");

/** O nome de arquivo é uma apresentação? */
export function isPowerPointName(name: string | undefined | null): boolean {
  const ext = String(name || "")
    .split(".")
    .pop()
    ?.toLowerCase();
  return !!ext && String(name).includes(".") && PPT_EXT.includes(ext);
}

/** Arquivo de fonte que pode ser arrastado: .ttf, .otf ou o .zip do DaFont. */
export function isFontFileName(name: string | undefined | null): boolean {
  return /\.(ttf|otf|zip)$/i.test(String(name || ""));
}

/** Fontes que o arquivo pede e que continuam faltando depois da conversão. */
export function missingFonts(fonts: PptxFont[] | undefined): string[] {
  return (fonts || [])
    .filter((f) => f.status === "missing" || f.status === "unmatched")
    .map((f) => f.name);
}

/**
 * Valida a resposta do IPC antes de usar (fronteira).
 * Qualquer coisa fora do contrato vira falha com mensagem genérica.
 */
export function parseConvertResult(raw: unknown): PptxConvertResult {
  const r = raw as Partial<PptxConvertResult> | null;
  if (r && r.ok === true && typeof r.path === "string" && r.path.toLowerCase().endsWith(".pdf")) {
    return {
      ok: true,
      path: r.path,
      cached: !!r.cached,
      converter: typeof r.converter === "string" ? r.converter : "",
      fonts: Array.isArray(r.fonts)
        ? r.fonts.filter((f) => f && typeof f.name === "string" && typeof f.status === "string")
        : [],
      staleFonts: !!r.staleFonts,
      fontsError: typeof r.fontsError === "string" ? r.fontsError : "",
      features: parseFeatures(r.features),
      nativeAvailable: r.nativeAvailable === true,
      permissionFallback: r.permissionFallback === true,
    };
  }
  const fail = r as { code?: unknown; message?: unknown } | null;
  return {
    ok: false,
    code: typeof fail?.code === "string" ? fail.code : "convert_failed",
    message:
      typeof fail?.message === "string" && fail.message ? fail.message : "falha desconhecida",
  };
}

/** Animações e mídias vindas do main, validadas (números inteiros ≥ 0). */
export function parseFeatures(raw: unknown): PptxFeatures {
  const f = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  return { animatedSlides: n(f.animatedSlides), videos: n(f.videos), audios: n(f.audios) };
}

/** O arquivo tem algo que o modo imagem deixa parado? */
export function hasRichContent(f: PptxFeatures | null | undefined): boolean {
  return !!f && f.animatedSlides + f.videos + f.audios > 0;
}

/** Texto curto do andamento, para a lista de tarefas em segundo plano. */
export function progressDetail(
  p: PptxProgress,
  tm: (_key: string, _named?: Record<string, unknown>) => string
): { detail: string; progress: number } | null {
  if (p.phase === "fonts") return { detail: tm("pptx.checking_fonts"), progress: 10 };
  if (p.phase === "font" && p.status === "searching")
    return { detail: tm("pptx.font_searching", { name: p.name }), progress: 25 };
  if (p.phase === "font" && p.status === "installed")
    return { detail: tm("pptx.font_installed", { name: p.name }), progress: 40 };
  if (p.phase === "converting" && p.total && p.total > 0) {
    const done = Math.min(p.done ?? 0, p.total);
    return {
      detail: tm("pptx.converting_count", { done, total: p.total }),
      progress: 45 + Math.round((50 * done) / p.total),
    };
  }
  if (p.phase === "converting")
    return { detail: tm("pptx.converting", { converter: p.converter || "" }), progress: 60 };
  return null;
}

export type FontTone = "success" | "warning" | "danger" | "neutral" | "primary";

/** Cor da situação de uma fonte: verde resolvida, vermelho faltando, cinza procurando. */
export function fontTone(status: string): FontTone {
  if (status === "missing") return "danger";
  if (status === "unmatched") return "warning";
  if (status === "searching") return "neutral";
  return "success";
}

/** Estado da janela de importação, montado a partir dos eventos de andamento. */
export interface PptxImportState {
  name: string;
  path: string;
  phase: "fonts" | "converting" | "done" | "error";
  converter: string;
  fonts: { name: string; status: string; source?: string | null }[];
  error: string;
  /** Contagem da geração dos slides (0/0 enquanto o conversor não informa). */
  slidesDone?: number;
  slidesTotal?: number;
  /** A conferência das fontes falhou: o motivo, para o operador ver. */
  fontsError?: string;
  /** O macOS bloqueou o container do PowerPoint: mostra "Abrir Ajustes"/"Tentar de novo". */
  macPermission?: boolean;
  /** id do item já salvo na biblioteca, para "Projetar agora". */
  fileId?: string;
  /** Animações/mídias do arquivo e se dá para usar o modo nativo aqui. */
  features?: PptxFeatures;
  nativeAvailable?: boolean;
}

/** Aplica um evento de andamento ao estado (função pura, testável). */
export function applyProgress(state: PptxImportState, p: PptxProgress): PptxImportState {
  if (p.path !== state.path) return state;
  if (p.phase === "fonts") {
    const next: PptxImportState = { ...state, phase: "fonts" };
    if (Array.isArray(p.fonts)) next.fonts = p.fonts.map((f) => ({ ...f }));
    if (typeof p.error === "string" && p.error) next.fontsError = p.error;
    return next;
  }
  if (p.phase === "converting") {
    const next: PptxImportState = { ...state, phase: "converting", converter: p.converter || "" };
    if (Number.isFinite(p.total) && (p.total as number) > 0) {
      next.slidesTotal = p.total;
      next.slidesDone = Math.min(Number(p.done) || 0, p.total as number);
    }
    return next;
  }
  if (p.phase === "font" && p.name) {
    const fonts = [...state.fonts];
    const i = fonts.findIndex((f) => f.name === p.name);
    const item = { name: p.name, status: p.status || "searching", source: p.source ?? null };
    if (i >= 0) fonts[i] = item;
    else fonts.push(item);
    return { ...state, fonts };
  }
  return state;
}
