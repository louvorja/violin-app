<template>
  <div ref="root" class="rpr">
    <!-- O que está no ar -->
    <header class="rpr-head">
      <div class="rpr-head__title">
        <strong>{{ state.title || t("remote_control.presentation.nothing") }}</strong>
        <span v-if="state.total" class="rpr-head__page">
          {{ t("remote_control.presentation.slide", { page: state.page, total: state.total }) }}
        </span>
      </div>
      <span v-if="state.native" class="rpr-chip">
        {{ t("remote_control.presentation.native") }}
      </span>
      <button type="button" class="rpr-open" @click="openFiles">
        <LjIcon :icon="ICONS.ACTIONS.FOLDER_OPEN" :size="18" />
        <span>{{ t("remote_control.presentation.open") }}</span>
      </button>
    </header>

    <!-- Algo no ar, mas o telão desligado: não aparece na projeção -->
    <div v-if="state.total && !state.screen && !state.native" class="rpr-screen" role="status">
      <span>{{ t("remote_control.presentation.screen_off") }}</span>
      <button
        type="button"
        class="rpr-pill rpr-pill--on"
        :disabled="screenBusy"
        @click="setScreen(true)"
      >
        <LjIcon :icon="ICONS.PROJECTION.SCREEN" :size="16" />
        {{ t("remote_control.presentation.screen_on_btn") }}
      </button>
    </div>

    <!-- Controle · Laser · Lousa -->
    <div class="rpr-modes" role="tablist">
      <button
        v-for="m in modes"
        :key="m.value"
        type="button"
        role="tab"
        class="rpr-mode"
        :class="{ 'rpr-mode--on': mode === m.value, [`rpr-mode--${m.value}`]: true }"
        :aria-selected="mode === m.value"
        @click="setMode(m.value)"
      >
        <LjIcon :icon="m.icon" :size="18" />
        <span>{{ m.label }}</span>
      </button>
    </div>

    <!-- O slide no ar: no laser e na lousa, o dedo aponta e desenha aqui -->
    <div
      ref="stageEl"
      class="rpr-stage"
      :class="{ 'rpr-stage--touch': mode !== 'control', 'rpr-stage--laser': mode === 'laser' }"
      :style="{ aspectRatio: String(state.aspect || 16 / 9) }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onUp"
    >
      <div v-if="board" class="rpr-stage__board" />
      <img v-else-if="currentSrc" :src="currentSrc" alt="" draggable="false" />
      <p v-else class="rpr-stage__empty">{{ t("remote_control.presentation.no_image") }}</p>
      <canvas ref="inkEl" class="rpr-stage__ink" />
      <div
        v-if="laserAt"
        class="rpr-stage__dot"
        :style="{ left: laserAt.x * 100 + '%', top: laserAt.y * 100 + '%' }"
      />
    </div>

    <!-- Sem monitor de projeção, laser e lousa não têm onde aparecer -->
    <p v-if="mode !== 'control' && noDisplay" class="rpr-warn" role="alert">
      {{ t("remote_control.presentation.no_display") }}
    </p>

    <!-- Controle -->
    <template v-if="mode === 'control'">
      <!-- Nada no ar: começa pela Biblioteca -->
      <div v-if="!state.total && !state.native" class="rpr-empty">
        <p class="rpr-hint">{{ t("remote_control.presentation.nothing_hint") }}</p>
        <button type="button" class="rpr-pill rpr-pill--on" @click="openFiles">
          <LjIcon :icon="ICONS.ACTIONS.FOLDER_OPEN" :size="18" />
          {{ t("remote_control.presentation.open") }}
        </button>
      </div>

      <!-- PowerPoint no ar: fontes e apresentar com animações -->
      <div v-if="state.pptx" class="rpr-pptx">
        <p v-if="state.pptx.missing.length" class="rpr-warn" role="alert">
          {{
            t("remote_control.presentation.fonts_missing", { names: state.pptx.missing.join(", ") })
          }}
        </p>
        <p v-else-if="state.pptx.staleFonts" class="rpr-warn" role="alert">
          {{ t("remote_control.presentation.fonts_stale") }}
        </p>
        <p v-else-if="!state.pptx.checked" class="rpr-hint">
          {{ t("remote_control.presentation.fonts_checking") }}
        </p>
        <button
          v-if="state.native"
          type="button"
          class="rpr-pill rpr-pill--danger"
          :disabled="nativeBusy"
          @click="setNative(false)"
        >
          <LjIcon :icon="ICONS.PLAYER.STOP" :size="16" />
          {{ t("remote_control.presentation.native_end") }}
        </button>
        <button
          v-else-if="state.pptx.canNative"
          type="button"
          class="rpr-pill rpr-pill--on"
          :disabled="nativeBusy || state.pptx.opening"
          @click="setNative(true)"
        >
          <LjIcon :icon="ICONS.PROJECTION.PRESENT" :size="16" />
          {{
            nativeBusy || state.pptx.opening
              ? t("remote_control.presentation.native_opening")
              : t("remote_control.presentation.native_start")
          }}
        </button>
        <p v-else class="rpr-hint">{{ t("remote_control.presentation.native_unavailable") }}</p>
      </div>
      <!-- O que vem depois, como no retorno de palco -->
      <div v-if="state.total && state.page < state.total" class="rpr-next">
        <span class="rpr-next__label">
          {{ t("remote_control.presentation.next_slide", { page: state.page + 1 }) }}
        </span>
        <img :src="slideUrl(state.page + 1, 480)" alt="" draggable="false" />
      </div>
      <p v-else-if="state.total" class="rpr-next__end">
        {{ t("remote_control.presentation.last_slide") }}
      </p>
      <div class="rpr-nav">
        <button
          type="button"
          class="rpr-btn"
          :aria-label="t('remote_control.presentation.first')"
          @click="nav('first')"
        >
          <LjIcon :icon="ICONS.PLAYER.PAGE_FIRST" :size="22" />
        </button>
        <button
          type="button"
          class="rpr-btn rpr-btn--big"
          :aria-label="t('actions.previous')"
          @click="nav('prev')"
        >
          <LjIcon :icon="ICONS.ACTIONS.PREVIOUS" :size="34" />
        </button>
        <button
          type="button"
          class="rpr-btn rpr-btn--big rpr-btn--accent"
          :aria-label="t('actions.next')"
          @click="nav('next')"
        >
          <LjIcon :icon="ICONS.ACTIONS.NEXT" :size="34" />
        </button>
        <button
          type="button"
          class="rpr-btn"
          :aria-label="t('remote_control.presentation.last')"
          @click="nav('last')"
        >
          <LjIcon :icon="ICONS.PLAYER.PAGE_LAST" :size="22" />
        </button>
      </div>
      <div class="rpr-row">
        <button
          type="button"
          class="rpr-pill"
          :class="{ 'rpr-pill--on': state.black }"
          @click="nav('black')"
        >
          <LjIcon :icon="ICONS.UI.EYE_OFF" :size="16" />
          {{ t("remote_control.presentation.black") }}
        </button>
        <button
          v-if="state.total && state.screen && !state.native"
          type="button"
          class="rpr-pill"
          :disabled="screenBusy"
          @click="setScreen(false)"
        >
          <LjIcon :icon="ICONS.PROJECTION.STOP" :size="16" />
          {{ t("remote_control.presentation.screen_off_btn") }}
        </button>
        <button type="button" class="rpr-pill" @click="emit('go-tab', 'media_library')">
          <LjIcon :icon="ICONS.ACTIONS.UPLOAD" :size="16" />
          {{ t("remote_control.presentation.upload") }}
        </button>
      </div>
      <div v-if="state.total" class="rpr-grid">
        <button
          v-for="n in state.total"
          :key="`${state.rev}-${n}`"
          type="button"
          class="rpr-thumb"
          :class="{ 'rpr-thumb--live': n === state.page }"
          @click="nav('goto', n)"
        >
          <img :src="slideUrl(n, 320)" alt="" loading="lazy" draggable="false" />
          <span>{{ n }}</span>
        </button>
      </div>
    </template>

    <!-- Laser -->
    <template v-else-if="mode === 'laser'">
      <!-- Lupa: o telão amplia em volta do dedo enquanto ele está no slide -->
      <button
        v-if="canZoom"
        type="button"
        class="rpr-pill rpr-zoom"
        :class="{ 'rpr-pill--on': zoomOn }"
        :aria-pressed="zoomOn"
        @click="zoomOn = !zoomOn"
      >
        <LjIcon :icon="ICONS.ACTIONS.SEARCH" :size="16" />
        {{ t("remote_control.presentation.zoom_toggle") }}
      </button>
      <p class="rpr-hint">
        {{
          state.native
            ? t("remote_control.presentation.laser_hint_native")
            : zoomOn
              ? t("remote_control.presentation.zoom_hint")
              : t("remote_control.presentation.laser_hint")
        }}
      </p>
    </template>

    <!-- Lousa -->
    <template v-else>
      <div class="rpr-tools">
        <button
          v-for="c in COLORS"
          :key="c"
          type="button"
          class="rpr-color"
          :class="{ 'rpr-color--on': color === c }"
          :style="{ background: c }"
          :aria-label="c"
          @click="color = c"
        />
      </div>
      <div class="rpr-tools">
        <button
          v-for="s in SIZES"
          :key="s.label"
          type="button"
          class="rpr-size"
          :class="{ 'rpr-size--on': size === s.value }"
          @click="size = s.value"
        >
          {{ s.label }}
        </button>
      </div>
      <div class="rpr-row">
        <button type="button" class="rpr-pill" @click="drawOp('undo')">
          <LjIcon :icon="ICONS.ACTIONS.UNDO" :size="16" />
          {{ t("remote_control.presentation.undo") }}
        </button>
        <button type="button" class="rpr-pill rpr-pill--danger" @click="drawOp('clear')">
          <LjIcon :icon="ICONS.ACTIONS.DELETE" :size="16" />
          {{ t("remote_control.presentation.clear") }}
        </button>
        <button
          type="button"
          class="rpr-pill"
          :class="{ 'rpr-pill--on': board }"
          @click="toggleBoard"
        >
          <LjIcon :icon="ICONS.LITURGY.BULLETIN_BOARD" :size="16" />
          {{
            board
              ? t("remote_control.presentation.board_off")
              : t("remote_control.presentation.board_on")
          }}
        </button>
      </div>
      <p class="rpr-hint">{{ t("remote_control.presentation.draw_hint") }}</p>
    </template>

    <!-- Abrir da Biblioteca: tocar = pôr no ar no modo apresentação -->
    <div
      v-if="filesOpen"
      class="rpr-sheet"
      role="dialog"
      :aria-label="t('remote_control.presentation.open_title')"
    >
      <div class="rpr-sheet__head">
        <strong>{{ t("remote_control.presentation.open_title") }}</strong>
        <button
          type="button"
          class="rpr-sheet__close"
          :aria-label="t('actions.close')"
          @click="filesOpen = false"
        >
          <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="20" />
        </button>
      </div>
      <input
        v-if="files.length > 8"
        v-model="filesQuery"
        type="search"
        class="rpr-sheet__search"
        :placeholder="t('remote_control.presentation.open_search')"
      />
      <p class="rpr-hint">{{ t("remote_control.presentation.open_hint") }}</p>
      <p v-if="filesLoading" class="rpr-hint">…</p>
      <p v-else-if="!files.length" class="rpr-hint">
        {{ t("remote_control.presentation.open_empty") }}
      </p>
      <ul v-else class="rpr-files">
        <li v-for="f in shownFiles" :key="f.id">
          <button type="button" class="rpr-file" :disabled="!!openingId" @click="openFile(f)">
            <LjIcon :icon="kindIcon(f.kind)" :size="22" />
            <span class="rpr-file__name">{{ f.name }}</span>
            <span class="rpr-file__kind">
              {{ t(`remote_control.presentation.kind_${f.kind}`) }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { apiFetch, postApi } from "@/helpers/ApiClient";

/**
 * Apresentação pelo celular, no espírito do SlideFlow: vê o slide no ar e as
 * miniaturas, toca para ir a um slide, aponta com o laser e desenha na lousa
 * por cima do telão. Rotas em `electron/main/httpServer/presenterRoutes.js`.
 */

const props = defineProps<{ token?: string }>();
const emit = defineEmits<{
  (_e: "show-snackbar", _message: string, _type?: string): void;
  (_e: "go-tab", _tab: string): void;
}>();
const { t } = useI18n();

type Mode = "control" | "laser" | "draw";
interface Stroke {
  points: [number, number][];
  color: string;
  size: number;
}
interface PresenterState {
  title: string;
  page: number;
  total: number;
  aspect: number;
  rev: string;
  native: boolean;
  black: boolean;
  overlay: { board: boolean; display?: boolean } | null;
  /** PowerPoint no ar: fontes e se dá para apresentar com animações. */
  pptx?: {
    canNative: boolean;
    opening: boolean;
    checked: boolean;
    missing: string[];
    staleFonts: boolean;
  } | null;
  /** A tela principal (o telão) está ligada. */
  screen?: boolean;
}

type FileKind = "pptx" | "pdf" | "image" | "video" | "file";
interface LibraryFile {
  id: string;
  name: string;
  kind: FileKind;
}

const COLORS = ["#ff4444", "#ffffff", "#ffd060", "#00d4aa", "#4da3ff", "#ff8c42", "#000000"];
const SIZES = [
  { label: "P", value: 2 },
  { label: "M", value: 4 },
  { label: "G", value: 8 },
  { label: "XG", value: 14 },
];
const POLL_MS = 1200;

const modes = computed(() => [
  {
    value: "control" as Mode,
    label: t("remote_control.presentation.mode_control"),
    icon: ICONS.PROJECTION.PRESENT,
  },
  {
    value: "laser" as Mode,
    label: t("remote_control.presentation.mode_laser"),
    icon: ICONS.PROJECTION.LASER,
  },
  {
    value: "draw" as Mode,
    label: t("remote_control.presentation.mode_draw"),
    icon: ICONS.ACTIONS.EDIT_OUTLINE,
  },
]);

const root = ref<HTMLElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const inkEl = ref<HTMLCanvasElement | null>(null);
const mode = ref<Mode>("control");
const state = ref<PresenterState>({
  title: "",
  page: 0,
  total: 0,
  aspect: 16 / 9,
  rev: "",
  native: false,
  black: false,
  overlay: null,
});
const board = ref(false);
const strokes = ref<Stroke[]>([]);
const color = ref(COLORS[0]);
const size = ref(4);
const laserAt = ref<{ x: number; y: number } | null>(null);
/** O PC disse que não há monitor de projeção ligado. */
const noDisplay = ref(false);

/** 409 = sem telão: mostra o aviso em vez de falhar calado. */
function checkDisplay(res: Response): void {
  if (res.status === 409) noDisplay.value = true;
}

const q = (extra = "") => `token=${encodeURIComponent(props.token ?? "")}${extra}`;
const slideUrl = (n: number, w: number) =>
  `/api/presenter/slide/${n}?w=${w}&v=${state.value.rev}&${q()}`;
const currentSrc = computed(() => (state.value.page ? slideUrl(state.value.page, 960) : ""));

// ── Estado ────────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
let lastError = 0;

async function refresh(): Promise<void> {
  // Aba escondida (v-show) ou celular com a tela apagada: não pergunta à toa.
  if (document.visibilityState !== "visible" || !root.value?.offsetParent) return;
  try {
    const res = await apiFetch(`/api/presenter/state?${q()}`);
    if (!res.ok) throw new Error(String(res.status));
    const next = (await res.json()) as PresenterState;
    const changed = next.page !== state.value.page || next.rev !== state.value.rev;
    state.value = next;
    if (next.overlay) {
      board.value = next.overlay.board;
      noDisplay.value = next.overlay.display === false;
    }
    if (changed && mode.value === "draw") void loadStrokes();
  } catch {
    if (Date.now() - lastError > 15_000) {
      lastError = Date.now();
      emit("show-snackbar", t("remote_control.presentation.offline"), "warning");
    }
  }
}

async function nav(action: string, page?: number): Promise<void> {
  try {
    await postApi("/api/presenter/nav", { action, ...(page ? { page } : {}) }, props.token);
    if (action !== "black") strokes.value = board.value ? strokes.value : [];
    redraw();
    setTimeout(refresh, 250);
  } catch {
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  }
}

// ── Abrir da Biblioteca ───────────────────────────────────────────────────
const filesOpen = ref(false);
const files = ref<LibraryFile[]>([]);
const filesLoading = ref(false);
const filesQuery = ref("");
const openingId = ref<string | null>(null);

const shownFiles = computed(() => {
  const q = filesQuery.value.trim().toLowerCase();
  return q ? files.value.filter((f) => f.name.toLowerCase().includes(q)) : files.value;
});

function kindIcon(kind: FileKind): string {
  if (kind === "pptx") return ICONS.PROJECTION.PRESENT;
  if (kind === "pdf") return ICONS.UI.FILE_PDF;
  if (kind === "image") return ICONS.MEDIA.IMAGE;
  if (kind === "video") return ICONS.MEDIA.VIDEO;
  return ICONS.ACTIONS.FOLDER_OPEN;
}

async function openFiles(): Promise<void> {
  filesOpen.value = true;
  filesQuery.value = "";
  filesLoading.value = true;
  try {
    const res = await apiFetch(`/api/presenter/files?${q()}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { items: LibraryFile[] };
    files.value = Array.isArray(data.items) ? data.items : [];
  } catch {
    files.value = [];
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  } finally {
    filesLoading.value = false;
  }
}

async function openFile(f: LibraryFile): Promise<void> {
  if (openingId.value) return;
  openingId.value = f.id;
  try {
    const res = await postApi("/api/presenter/open", { id: f.id }, props.token);
    if (!res.ok) throw new Error(String(res.status));
    filesOpen.value = false;
    mode.value = "control";
    emit("show-snackbar", t("remote_control.presentation.opening", { name: f.name }), "info");
    // O PowerPoint pode levar alguns segundos para converter: pergunta logo e de novo.
    setTimeout(refresh, 600);
    setTimeout(refresh, 2000);
  } catch {
    emit("show-snackbar", t("remote_control.presentation.open_failed"), "error");
  } finally {
    openingId.value = null;
  }
}

// ── Telão e PowerPoint com animações ──────────────────────────────────────
const screenBusy = ref(false);
const nativeBusy = ref(false);

async function setScreen(on: boolean): Promise<void> {
  if (screenBusy.value) return;
  screenBusy.value = true;
  try {
    const res = await postApi("/api/presenter/screen", { on }, props.token);
    if (!res.ok) throw new Error(String(res.status));
    await refresh();
  } catch {
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  } finally {
    screenBusy.value = false;
  }
}

async function setNative(on: boolean): Promise<void> {
  if (nativeBusy.value) return;
  nativeBusy.value = true;
  try {
    const res = await postApi("/api/presenter/native", { on }, props.token);
    if (!res.ok) throw new Error(String(res.status));
    await refresh();
  } catch {
    if (on) emit("show-snackbar", t("remote_control.presentation.native_failed"), "error");
    else emit("show-snackbar", t("remote_control.errors.generic"), "error");
  } finally {
    nativeBusy.value = false;
  }
}

// ── Laser ─────────────────────────────────────────────────────────────────
let laserPending: { x: number; y: number } | null = null;
let laserBusy = false;

async function pumpLaser(): Promise<void> {
  if (laserBusy || !laserPending) return;
  laserBusy = true;
  const p = laserPending;
  laserPending = null;
  try {
    checkDisplay(await postApi("/api/presenter/laser", p, props.token));
  } catch {
    /* o próximo movimento tenta de novo */
  } finally {
    laserBusy = false;
    if (laserPending) void pumpLaser();
  }
}

function hideLaser(): void {
  laserAt.value = null;
  laserPending = null;
  void postApi("/api/presenter/laser", { hide: true }, props.token).catch(() => {});
  if (applied || zoomPending) void zoomFit();
}

// ── Ampliar onde aponto ────────────────────────────────────────────────────
/** A lupa só vale para imagem e página de PDF no ar (o PowerPoint apresentando não amplia). */
const canZoom = computed(() => state.value.total > 0 && !state.value.native);
const zoomOn = ref(false);
/** O recorte que o PC aplicou: o laser vai para onde o ponto aparece ampliado. */
let applied: { scale: number; cx: number; cy: number } | null = null;
let zoomPending: Promise<void> | null = null;

function toScreen(x: number, y: number): { x: number; y: number } {
  if (!applied) return { x, y };
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: c(0.5 + (x - applied.cx) * applied.scale),
    y: c(0.5 + (y - applied.cy) * applied.scale),
  };
}

function sendLaser(x: number, y: number): void {
  laserAt.value = { x, y };
  laserPending = toScreen(x, y);
  void pumpLaser();
}

async function zoomAt(x: number, y: number): Promise<void> {
  try {
    const res = await postApi("/api/presenter/zoom", { scale: 2, x, y }, props.token);
    if (!res.ok) return;
    const data = (await res.json()) as { zoom: { scale: number; cx: number; cy: number } | null };
    applied = data.zoom;
  } catch {
    applied = null;
  }
}

async function zoomFit(): Promise<void> {
  if (zoomPending) await zoomPending;
  zoomPending = null;
  applied = null;
  await postApi("/api/presenter/zoom", { fit: true }, props.token).catch(() => {});
}

// ── Lousa ─────────────────────────────────────────────────────────────────
let current: Stroke | null = null;

async function loadStrokes(): Promise<void> {
  try {
    const res = await apiFetch(`/api/presenter/draw?${q()}`);
    if (!res.ok) return;
    const data = (await res.json()) as { strokes: Stroke[]; board: boolean };
    strokes.value = data.strokes || [];
    board.value = data.board;
    redraw();
  } catch {
    /* fica o que já estava */
  }
}

async function drawOp(op: "undo" | "clear"): Promise<void> {
  if (op === "undo") strokes.value = strokes.value.slice(0, -1);
  else strokes.value = [];
  redraw();
  await postApi("/api/presenter/draw", { op }, props.token).catch(() => {});
}

async function toggleBoard(): Promise<void> {
  const on = !board.value;
  board.value = on;
  strokes.value = [];
  redraw();
  const res = await postApi("/api/presenter/draw", { op: "board", on }, props.token).catch(
    () => null
  );
  if (res) checkDisplay(res);
}

function ctx(): { c: CanvasRenderingContext2D; w: number; h: number } | null {
  const canvas = inkEl.value;
  if (!canvas) return null;
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}

function drawStroke(c: CanvasRenderingContext2D, s: Stroke, w: number, h: number): void {
  const pts = s.points;
  if (!pts.length) return;
  c.save();
  c.strokeStyle = s.color;
  c.fillStyle = s.color;
  c.lineWidth = Math.max(1.2, (s.size * w) / 1000);
  c.lineCap = "round";
  c.lineJoin = "round";
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0][0] * w, pts[0][1] * h, c.lineWidth / 2, 0, Math.PI * 2);
    c.fill();
  } else {
    c.beginPath();
    c.moveTo(pts[0][0] * w, pts[0][1] * h);
    for (const p of pts.slice(1)) c.lineTo(p[0] * w, p[1] * h);
    c.stroke();
  }
  c.restore();
}

function redraw(): void {
  const k = ctx();
  if (!k) return;
  k.c.clearRect(0, 0, k.w, k.h);
  for (const s of strokes.value) drawStroke(k.c, s, k.w, k.h);
  if (current) drawStroke(k.c, current, k.w, k.h);
}

// ── Toque no slide ────────────────────────────────────────────────────────
function norm(e: PointerEvent): [number, number] {
  const r = stageEl.value!.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  return [Number(x.toFixed(4)), Number(y.toFixed(4))];
}

let pressing = false;

function onDown(e: PointerEvent): void {
  if (mode.value === "control") return;
  e.preventDefault();
  pressing = true;
  stageEl.value?.setPointerCapture?.(e.pointerId);
  const [x, y] = norm(e);
  if (mode.value === "laser") {
    if (zoomOn.value && canZoom.value) {
      // Amplia primeiro: o laser já sai no lugar certo do slide ampliado.
      laserAt.value = { x, y };
      zoomPending = zoomAt(x, y).then(() =>
        sendLaser(laserAt.value?.x ?? x, laserAt.value?.y ?? y)
      );
    } else {
      sendLaser(x, y);
    }
  } else {
    current = { points: [[x, y]], color: color.value, size: size.value };
    redraw();
  }
}

function onMove(e: PointerEvent): void {
  if (!pressing || mode.value === "control") return;
  e.preventDefault();
  const [x, y] = norm(e);
  if (mode.value === "laser") {
    if (zoomPending && !applied) laserAt.value = { x, y };
    else sendLaser(x, y);
  } else if (current) {
    const last = current.points[current.points.length - 1];
    if (Math.abs(last[0] - x) + Math.abs(last[1] - y) < 0.003) return;
    current.points.push([x, y]);
    redraw();
  }
}

function onUp(): void {
  if (!pressing) return;
  pressing = false;
  if (mode.value === "laser") {
    hideLaser();
  } else if (current) {
    const s = current;
    current = null;
    strokes.value = [...strokes.value, s];
    redraw();
    void postApi("/api/presenter/draw", { op: "stroke", stroke: s }, props.token)
      .then(checkDisplay)
      .catch(() => emit("show-snackbar", t("remote_control.errors.generic"), "error"));
  }
}

function setMode(m: Mode): void {
  if (mode.value === "laser" && m !== "laser") hideLaser();
  mode.value = m;
  if (m === "draw") void loadStrokes();
  void nextTick(redraw);
}

watch(
  () => state.value.aspect,
  () => nextTick(redraw)
);

onMounted(() => {
  void refresh();
  timer = setInterval(refresh, POLL_MS);
  window.addEventListener("resize", redraw);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener("resize", redraw);
  if (laserAt.value) hideLaser();
});
</script>

<style scoped>
.rpr {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
  min-height: 100%;
}

.rpr-head {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}

.rpr-head__title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.rpr-head__title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rpr-head__page {
  font-size: 0.8125rem;
  color: var(--lj-text-muted, inherit);
  font-variant-numeric: tabular-nums;
}

.rpr-chip {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
  font-size: 0.75rem;
}

.rpr-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--lj-space-2);
}

.rpr-mode {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-2);
  min-height: 44px;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
}

.rpr-mode--on {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}

.rpr-mode--laser.rpr-mode--on {
  background: #e53935;
  border-color: #e53935;
  color: #fff;
}

.rpr-stage {
  position: relative;
  width: 100%;
  max-height: 46vh;
  margin: 0 auto;
  overflow: hidden;
  border-radius: var(--lj-ui-radius);
  background: #000;
  border: var(--lj-ui-border);
  user-select: none;
  -webkit-user-select: none;
}

.rpr-stage--touch {
  touch-action: none;
  border-color: var(--lj-ui-accent);
}

.rpr-stage--laser {
  border-color: #e53935;
}

.rpr-stage img,
.rpr-stage__board,
.rpr-stage__ink {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.rpr-stage img {
  object-fit: contain;
  pointer-events: none;
}

.rpr-stage__board {
  background: #fff;
}

.rpr-stage__empty {
  position: absolute;
  inset: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--lj-space-4);
  text-align: center;
  color: #bbb;
  font-size: 0.875rem;
}

.rpr-stage__dot {
  position: absolute;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: #ff2a2a;
  box-shadow: 0 0 12px 4px rgba(255, 40, 40, 0.6);
  pointer-events: none;
}

.rpr-nav {
  display: grid;
  grid-template-columns: 1fr 2fr 2fr 1fr;
  gap: var(--lj-space-2);
}

.rpr-btn {
  min-height: 64px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  cursor: pointer;
  transition: transform 80ms;
}

.rpr-btn--big {
  min-height: 84px;
}

.rpr-btn--accent {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}

.rpr-btn:active,
.rpr-pill:active,
.rpr-thumb:active {
  transform: scale(0.97);
}

.rpr-row,
.rpr-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
}

.rpr-pill {
  flex: 1;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-2);
  padding: 0 var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
}

.rpr-pill--on {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}

.rpr-pill--danger {
  color: var(--lj-danger);
}

.rpr-color {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--lj-surface-border);
  cursor: pointer;
}

.rpr-color--on {
  outline: 3px solid var(--lj-ui-accent);
  outline-offset: 2px;
}

.rpr-size {
  flex: 1;
  min-height: 40px;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  font-weight: var(--lj-weight-medium);
  cursor: pointer;
}

.rpr-size--on {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}

.rpr-warn {
  margin: 0;
  padding: var(--lj-space-3);
  border: 1px solid var(--lj-warning);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-warning);
  font-size: 0.8125rem;
  text-align: center;
}

.rpr-next {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}

.rpr-next__label {
  flex: 1;
  font-size: 0.8125rem;
  color: var(--lj-text-muted, inherit);
}

.rpr-next img {
  width: 42%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  background: #000;
  border: 2px solid var(--lj-live-select, var(--lj-ui-accent));
  border-radius: 4px;
}

.rpr-next__end {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--lj-text-muted, inherit);
  text-align: center;
}

.rpr-zoom {
  flex: 0 0 auto;
}

.rpr-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--lj-text-muted, inherit);
  text-align: center;
}

.rpr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--lj-space-2);
}

.rpr-thumb {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
  background: none;
  border: none;
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
}

.rpr-thumb img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  background: #000;
  border: 2px solid var(--lj-surface-border);
  border-radius: 4px;
}

.rpr-thumb span {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.rpr-thumb--live img {
  border-color: var(--lj-orange, var(--lj-ui-accent));
}

.rpr-thumb--live span {
  color: var(--lj-orange, var(--lj-ui-accent));
  font-weight: 700;
}

.rpr-open {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-height: 40px;
  padding: 0 var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
}

.rpr-screen {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  padding: var(--lj-space-3);
  border: 1px solid var(--lj-warning);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-warning);
  font-size: 0.8125rem;
  text-align: center;
}

.rpr-empty,
.rpr-pptx {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}

.rpr-pill:disabled,
.rpr-file:disabled {
  opacity: 0.6;
  cursor: default;
}

.rpr-sheet {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4);
  background: var(--lj-bg, var(--lj-surface-bg));
  overflow-y: auto;
  pointer-events: auto;
}

.rpr-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-3);
}

.rpr-sheet__close {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  color: var(--lj-text);
  cursor: pointer;
}

.rpr-sheet__search {
  min-height: 44px;
  padding: 0 var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
}

.rpr-files {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

.rpr-file {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: 0 var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.rpr-file__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rpr-file__kind {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--lj-text-muted, inherit);
}
</style>
