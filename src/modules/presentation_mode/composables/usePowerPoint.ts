import { reactive, ref } from "vue";
import Platform from "@/helpers/Platform";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import { i18nAtual } from "@/i18n";

/**
 * PowerPoint no culto: o PowerPoint instalado no computador converte o arquivo
 * em PDF (no main, com cache), e o PDF passa com o passador como qualquer
 * outro. Pedir a conversão antes — ao ver o arquivo no palco — deixa o envio
 * instantâneo na hora do culto.
 */

const PPT_EXT = ["ppt", "pptx", "pps", "ppsx", "pptm", "ppsm"];

/**
 * Ligado: a conversão agora é a mesma da Biblioteca de Mídia (`main/pptx`):
 * fontes instaladas antes, cada slide desenhado como imagem pelo próprio
 * PowerPoint (ou pelo LibreOffice), então os textos saem como no original.
 */
export const POWERPOINT_ENABLED = true;
/** Só mostra o andamento se demorar: a conversão em cache volta na hora. */
const NOTICE_AFTER_MS = 600;

/** O que a conversão descobriu do arquivo: fontes e o que o PDF deixa parado. */
export interface PowerPointInfo {
  fonts: PptxFont[];
  staleFonts: boolean;
  fontsError: string;
  features: PptxFeatures | null;
}

/** Andamento da conversão em curso (uma por vez: o main tem fila). */
export interface PowerPointProgress {
  path: string;
  name: string;
  phase: PptxProgress["phase"];
  fontName?: string;
  converter?: string;
  done?: number;
  total?: number;
}

/** Caminho do .pptx → o que se sabe dele. Preenchido a cada conversão. */
export const powerPointInfo = reactive(new Map<string, PowerPointInfo>());
/** A conversão que está demorando, para a faixa de andamento do módulo. */
export const powerPointProgress = ref<PowerPointProgress | null>(null);

let progressInstalled = false;
/** Conversões pedidas e ainda sem resposta: caminho → quantas. */
const pending = new Map<string, number>();
const visibleAt = new Map<string, number>();
/** Caminho → nome que o operador conhece (o título na grade, não o nome do arquivo). */
const names = new Map<string, string>();

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? path;
}

function installProgress(): void {
  if (progressInstalled) return;
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!api?.onProgress) return;
  progressInstalled = true;
  api.onProgress((p) => {
    if (!p?.path || !pending.has(p.path)) return;
    if (p.phase === "done") return;
    const prev = powerPointProgress.value?.path === p.path ? powerPointProgress.value : null;
    const next: PowerPointProgress = {
      path: p.path,
      name: prev?.name ?? names.get(p.path) ?? baseName(p.path),
      phase: p.phase,
      fontName: p.phase === "font" ? p.name : undefined,
      converter: p.converter ?? prev?.converter,
      done: p.done ?? (p.phase === "converting" ? prev?.done : undefined),
      total: p.total ?? (p.phase === "converting" ? prev?.total : undefined),
    };
    // Só aparece se demorar; a partir daí acompanha cada evento.
    if (powerPointProgress.value?.path === p.path) powerPointProgress.value = next;
    else if (!visibleAt.has(p.path)) {
      const at = Date.now();
      visibleAt.set(p.path, at);
      setTimeout(() => {
        if (pending.has(p.path) && visibleAt.get(p.path) === at) powerPointProgress.value = next;
      }, NOTICE_AFTER_MS);
    }
  });
}

type ConvertResponse = Awaited<
  ReturnType<NonNullable<LouvorjaApi["storage"]["convertPresentation"]>>
>;

/** Como `convert`, com o nome que o operador vê na faixa de andamento. */
function convertNamed(path: string, name: string): Promise<ConvertResponse | null> {
  names.set(path, name);
  return convert(path);
}

/** Uma conversão, com o andamento à vista e o que ela descobriu guardado. */
async function convert(path: string, opts?: { force?: boolean }): Promise<ConvertResponse | null> {
  installProgress();
  pending.set(path, (pending.get(path) ?? 0) + 1);
  try {
    const res = (await Platform.convertPresentation(path, opts).catch(() => null)) as ConvertResponse | null;
    if (res?.ok) {
      const r = res as Extract<ConvertResponse, { ok: true }> & Partial<PowerPointInfo>;
      powerPointInfo.set(path, {
        fonts: Array.isArray(r.fonts) ? r.fonts : [],
        staleFonts: r.staleFonts === true,
        fontsError: typeof r.fontsError === "string" ? r.fontsError : "",
        features: r.features ?? null,
      });
    }
    return res;
  } finally {
    const n = (pending.get(path) ?? 1) - 1;
    if (n > 0) pending.set(path, n);
    else {
      pending.delete(path);
      visibleAt.delete(path);
      if (powerPointProgress.value?.path === path) powerPointProgress.value = null;
    }
  }
}

/** Fontes que o arquivo pede e que continuam faltando. */
export function missingFontNames(info: PowerPointInfo | null | undefined): string[] {
  return (info?.fonts ?? [])
    .filter((f) => f.status === "missing" || f.status === "unmatched")
    .map((f) => f.name);
}

/** O que se sabe do arquivo; sem nada guardado (app reaberto), pergunta ao main. */
export function loadPowerPointInfo(path: string): void {
  if (!POWERPOINT_ENABLED || powerPointInfo.has(path) || pending.has(path)) return;
  void convert(path);
}

/**
 * "Gerar de novo": converte ignorando o PDF guardado. Devolve o PDF novo (com
 * outro endereço, para a tela recarregar) ou null.
 */
export async function regeneratePowerPoint(path: string, name: string): Promise<string | null> {
  const res = await convert(path, { force: true });
  if (res?.ok) return res.pdf;
  $snackbar.error(tm(chaveDoErro(res?.error), { name }), { timeout: 8000 });
  return null;
}

/** Mensagem localizada para a falha de conversão (o main só manda o código). */
function chaveDoErro(error: string | undefined): "unsupported" | "mac_permission" | "failed" {
  return error === "unsupported" || error === "mac_permission" ? error : "failed";
}

export function isPowerPoint(path: string): boolean {
  return PPT_EXT.includes(path.split(".").pop()?.toLowerCase() ?? "");
}

function tm(key: string, params?: Record<string, unknown>): string {
  const t = i18nAtual()?.global?.t as ((k: string, p?: unknown) => unknown) | undefined;
  const full = `modules.presentation_mode.pptx.${key}`;
  return t ? String(t(full, params)) : full;
}

/**
 * Converte em segundo plano, sem avisos: o resultado fica no cache do main.
 * Com um item do programa, os arquivos filhos (de um momento) também.
 */
export function preparePowerPoint(
  path: string | null,
  item?: { children?: { path?: string }[] } | null
): void {
  if (!POWERPOINT_ENABLED) return;
  for (const p of [path, ...(item?.children ?? []).map((c) => c.path)])
    if (p && isPowerPoint(p)) void convert(p);
}

/** O PDF do PowerPoint, ou null (o operador já foi avisado do porquê). */
export async function powerPointAsPdf(path: string, name: string): Promise<string | null> {
  if (!POWERPOINT_ENABLED) {
    Telemetry.track("presentation_pptx_failed", { error: "disabled" });
    $snackbar.warning(tm("disabled", { name }), { timeout: 8000 });
    return null;
  }
  const res = await convertNamed(path, name);
  if (res?.ok) {
    if (res.permissionFallback) {
      $snackbar.warning(tm("permission_fallback", { name }), { timeout: 10000 });
    }
    // Fonte que não deu para instalar sozinha: o slide sai, mas com outra letra.
    const faltam = (res as { missingFonts?: unknown }).missingFonts;
    if (Array.isArray(faltam) && faltam.length) {
      $snackbar.warning(tm("missing_fonts", { name, fonts: faltam.join(", ") }), { timeout: 10000 });
    }
    return res.pdf;
  }
  const error = res?.error ?? "exception";
  Telemetry.track("presentation_pptx_failed", { error });
  $snackbar.error(tm(chaveDoErro(error), { name }), { timeout: 8000 });
  return null;
}
