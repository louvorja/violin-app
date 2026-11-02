import { computed, ref } from "vue";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import { KEYS } from "@/constants/UserDataKeys";
import { i18nAtual } from "@/i18n";

/**
 * PowerPoint com animações no modo apresentação.
 *
 * O PDF do PowerPoint continua no ar pelo caminho de sempre (grade, retorno,
 * miniaturas); "Apresentar com animações" põe o próprio PowerPoint — ou o
 * LibreOffice, conforme Opções — em tela cheia por cima da tela do PA. O
 * passador e a grade passam a mandar nele, e a página do PDF acompanha o slide
 * em que ele está: o retorno segue certo e, se o PowerPoint fechar, a tela por
 * baixo já está no slide certo. O main faz o resto (`main/pptx/nativeShow.js`).
 */

type Engine = "auto" | "powerpoint" | "libreoffice";

const state = ref<PptxNativeState>({ active: false });
const opening = ref(false);
const available = ref(false);
const appName = ref("PowerPoint");
let installed = false;
/** Um toque de tecla chega por mais de um caminho: o mesmo passo em < 350 ms vale um. */
let lastStep = { action: "", at: 0 };
/** Quem quer saber quando a apresentação chegou ao fim pelo passador. */
const finishedListeners = new Set<() => void>();

function api() {
  return (Platform.api as LouvorjaApi | null)?.pptx ?? null;
}

function engine(): Engine {
  const e = $userdata.get<string>(KEYS.OPTIONS.FILE_PROJECTION.PRESENTATION_ENGINE, "auto");
  return e === "powerpoint" || e === "libreoffice" ? e : "auto";
}

function tm(key: string, params?: Record<string, unknown>): string {
  const t = i18nAtual()?.global?.t as ((k: string, p?: unknown) => unknown) | undefined;
  const full = `modules.presentation_mode.pptx.${key}`;
  return t ? String(t(full, params)) : full;
}

function apply(next: PptxNativeState | null | undefined): void {
  const wasActive = state.value.active === true;
  state.value = next && typeof next === "object" ? next : { active: false };
  // Passou do último slide (não foi o Encerrar nem o Esc): o passador segue para o
  // próximo arquivo da pasta ou do momento, como faria no fim do PDF.
  if (wasActive && !state.value.active && state.value.motivo === "fim")
    for (const cb of finishedListeners) cb();
  if (state.value.engine === "libreoffice") appName.value = "LibreOffice";
  else if (state.value.engine === "powerpoint") appName.value = "PowerPoint";
}

/** Pergunta ao main se dá para apresentar com animações aqui, com o programa escolhido. */
async function refresh(): Promise<void> {
  const a = api();
  if (!a?.status) return;
  try {
    const s = await a.status(engine());
    available.value = s?.native === true;
    if (typeof s?.converter === "string" && s.converter) appName.value = s.converter;
  } catch {
    available.value = false;
  }
}

function install(): void {
  if (installed) return;
  const a = api();
  if (!a?.onNativeState) return;
  installed = true;
  a.onNativeState(apply);
  void a.nativeState().then((s) => s?.active && apply(s));
  void refresh();
}

async function start(pptxPath: string, startIndex = 0): Promise<boolean> {
  const a = api();
  if (!a || opening.value) return false;
  opening.value = true;
  try {
    const r = await a.nativeStart(pptxPath, Math.max(0, startIndex), engine());
    if (!r.ok) {
      Telemetry.track("presentation_pptx_native_failed", { code: r.code });
      $snackbar.error(tm("native_failed", { app: appName.value, message: r.message }), { timeout: 10000 });
      return false;
    }
    apply(r.state);
    return true;
  } catch (e) {
    $snackbar.error(tm("native_failed", { app: appName.value, message: (e as Error)?.message ?? String(e) }), {
      timeout: 10000,
    });
    return false;
  } finally {
    opening.value = false;
  }
}

async function nav(action: "next" | "prev" | "goto" | "black", index?: number): Promise<void> {
  const a = api();
  if (!a || !state.value.active) return;
  if (action === "next" || action === "prev") {
    const now = Date.now();
    if (lastStep.action === action && now - lastStep.at < 350) return;
    lastStep = { action, at: now };
  }
  const r = await a.nativeNav(action, index);
  if (r.ok) apply(r.state);
}

async function end(): Promise<void> {
  const a = api();
  if (!a) return;
  const r = await a.nativeEnd();
  apply(r.ok ? r.state : { active: false });
}

export function usePptxNative() {
  install();
  return {
    state,
    active: computed(() => state.value.active === true),
    opening,
    available,
    appName,
    refresh,
    start,
    next: () => nav("next"),
    prev: () => nav("prev"),
    goto: (index: number) => nav("goto", index),
    toggleBlack: () => nav("black"),
    end,
    /** Avisa quando o passador passa do último slide. Devolve a função que desliga. */
    onFinished(cb: () => void): () => void {
      finishedListeners.add(cb);
      return () => finishedListeners.delete(cb);
    },
  };
}
