<template>
  <div
    ref="wheelEl"
    class="draw-wheel"
    :class="{
      'draw-wheel--large': large,
      'draw-wheel--settled': settled,
      'draw-wheel--restarting': restarting,
      'draw-wheel--restart-overlay': restarting && restartOriginValue !== null,
    }"
    :style="{
      '--wheel-transition-ms': `${transitionMs}ms`,
      '--draw-restart-ms': `${RESTART_MS}ms`,
      '--draw-name-scale': nameScale,
    }"
    aria-hidden="true"
  >
    <div class="draw-wheel__viewport">
      <span
        v-for="row in rows"
        :key="row.key"
        class="draw-wheel__row"
        :class="{
          'draw-wheel__row--center': Math.abs(row.delta) < 0.5,
          'draw-wheel__row--restart-origin': restarting && row.value === restartOriginValue,
        }"
        :style="row.style"
      >
        <span class="draw-wheel__row-text">{{ row.value }}</span>
      </span>
      <!-- O número anterior fica no centro enquanto a roda já recomeça. Ele é
           desenhado fora das linhas para não reiniciar o zoom ao trocar de slot. -->
      <span v-if="restarting && restartOriginValue !== null" class="draw-wheel__origin">
        <span class="draw-wheel__origin-text">{{ restartOriginValue }}</span>
      </span>
    </div>
    <div class="draw-wheel__band" :style="bandStyle ?? undefined" />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
} from "vue";
import type { ModuleWheelState } from "@/presentation/ModulePresentationState";
import { DRAW_DURATION_MAX_MS, DRAW_DURATION_MIN_MS } from "../constants";
import { createBoomerangPlan } from "../boomerang";

const props = withDefaults(
  defineProps<{
    wheel: ModuleWheelState;
    large?: boolean;
    /** Faixa central herdando as opções de fundo do texto do módulo. */
    bandStyle?: CSSProperties | null;
    /** Muda quando fonte/tamanho mudam para refazer o ajuste dos nomes. */
    fontKey?: string;
  }>(),
  { large: false, bandStyle: null, fontKey: "" }
);

const ROW_EM = 1.18;
const VISIBLE_ROWS = 7;
const RESTART_MS = 520;
// O número central aparece com estes dois zooms quando a roda assenta.
const CENTER_TEXT_SCALE = 1.5;
const CENTER_ROW_SCALE = 1.25;

const wheelEl = ref<HTMLElement | null>(null);
const nameScale = ref(1);
const offset = ref(0);
const settled = computed(() => props.wheel.settled === true);
const transitionMs = computed(() => Math.min(220, Math.max(120, props.wheel.duration * 0.15)));
const restarting = ref(false);
const restartOriginValue = ref<string | null>(null);
let wasSettled = false;
let settledValue: string | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let raf: number | null = null;

const count = computed(() => {
  if (props.wheel.items?.length) return props.wheel.items.length;
  if (props.wheel.mode === "names") return 0;
  const min = props.wheel.min;
  const max = props.wheel.max;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  return Math.max(0, Number(max) - Number(min) + 1);
});

const targetIndex = computed(() => {
  if (!count.value) return 0;
  if (props.wheel.items?.length) {
    const index = props.wheel.items.indexOf(props.wheel.target);
    return index >= 0 ? index : 0;
  }
  const min = Number(props.wheel.min);
  const parsed = Number(props.wheel.target);
  if (!Number.isFinite(min) || !Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(count.value - 1, parsed - min));
});

function valueAt(index: number): string {
  if (!count.value) return "";
  const normalized = ((index % count.value) + count.value) % count.value;
  if (props.wheel.items?.length) return props.wheel.items[normalized] || "";
  if (props.wheel.mode === "number") return String(Number(props.wheel.min) + normalized);
  return "";
}

const rows = computed(() => {
  const center = Math.floor(offset.value);
  const result: {
    key: string;
    value: string;
    delta: number;
    style: Record<string, string | number>;
  }[] = [];

  for (let i = -Math.floor(VISIBLE_ROWS / 2); i <= Math.floor(VISIBLE_ROWS / 2); i++) {
    const index = center + i;
    const delta = index - offset.value;
    const distance = Math.abs(delta);
    const centerZoom = 1 + 0.25 * Math.pow(Math.max(0, 1 - distance), 2);
    const scale = Math.max(0.74, 1 - distance * 0.09) * centerZoom;
    result.push({
      // Chave fixa da posição, não do valor, para que a transição de saída seja aplicada ao mesmo elemento
      key: `slot-${i}`,
      value: valueAt(index),
      delta,
      style: {
        transform: `translateY(calc(-50% + ${delta * ROW_EM}em)) translateZ(${-Math.min(distance, 3) * 22}px) rotateX(${delta * 23}deg) scale(${scale})`,
        opacity: Math.max(0.1, 1 - distance * 0.27),
        zIndex: String(20 - Math.round(distance * 4)),
      },
    });
  }
  return result;
});

function stop(): void {
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  restarting.value = false;
}

function start(): void {
  stop();
  if (!count.value) {
    offset.value = 0;
    return;
  }

  const target = targetIndex.value;
  const duration = Math.max(
    DRAW_DURATION_MIN_MS,
    Math.min(DRAW_DURATION_MAX_MS, props.wheel.duration)
  );
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  if (reduceMotion || settled.value) {
    offset.value = target;
    return;
  }

  // Ao reiniciar, o número volta de 1.5 para 1 e as opções voltam do estado
  // encolhido. A origem é capturada antes do salto de offset e marcada pelo
  // valor, porque o número sorteado troca de slot enquanto a roda gira.
  const restartFromSettled = wasSettled;
  wasSettled = false;
  restartOriginValue.value = restartFromSettled ? settledValue : null;
  settledValue = null;
  restarting.value = true;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restarting.value = false;
    restartTimer = null;
  }, RESTART_MS);

  // O giro e as transições de saída começam juntos. O deslocamento inicial usa
  // o centro anterior para não revelar o novo alvo antes da hora. Voltas
  // completas entre origem e destino mantêm o giro mesmo quando o sorteio
  // repete o resultado anterior.
  const turns = count.value < 8 ? 4 : 2;
  // Começa visualmente no resultado anterior e termina visualmente no novo
  // alvo, mas com voltas completas entre os dois pontos. Subtrair/duplicar
  // ciclos nos dois lados mantinha o mesmo valor visível, porém anulava o giro
  // quando o alvo repetia o resultado anterior.
  const startOffset = offset.value + count.value * turns;
  const endOffset = target - count.value * turns;
  const boomerang = createBoomerangPlan(props.wheel.run_id, props.wheel.random_finish !== false);
  const startedAt = performance.now();

  // O giro parte do resultado anterior (ou do primeiro item) no mesmo instante
  // em que as opções voltam a aparecer.
  offset.value = startOffset;

  const easeInOutCubic = (value: number): number =>
    value < 0.5 ? 4 * Math.pow(value, 3) : 1 - Math.pow(-2 * value + 2, 3) / 2;

  const firstBoomerangOffset = endOffset + boomerang.positions[0];
  const totalMs = duration + boomerang.totalMs;

  const tick = (now: number) => {
    const elapsed = now - startedAt;

    if (elapsed <= duration) {
      // O giro usa exatamente a duração configurada e termina já passando um
      // pouco do centro.
      const progress = Math.min(1, elapsed / duration);
      const local = easeInOutCubic(progress);
      offset.value = startOffset + (firstBoomerangOffset - startOffset) * local;
    } else {
      let segment = 0;
      let segmentElapsed = elapsed - duration;
      while (
        segment < boomerang.durations.length &&
        segmentElapsed > boomerang.durations[segment]
      ) {
        segmentElapsed -= boomerang.durations[segment];
        segment += 1;
      }

      if (segment >= boomerang.durations.length) {
        offset.value = endOffset;
      } else {
        const from = endOffset + boomerang.positions[segment];
        const to = endOffset + boomerang.positions[segment + 1];
        const local = easeInOutCubic(Math.min(1, segmentElapsed / boomerang.durations[segment]));
        offset.value = from + (to - from) * local;
      }
    }

    if (elapsed >= totalMs) {
      offset.value = endOffset;
      raf = null;
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
}

// Nomes longos não podem ser cortados pela roda. Mede o maior nome no tamanho
// configurado e reduz apenas o texto, mantendo o espaçamento e a faixa da roda.
function updateNameScale(): void {
  if (props.wheel.mode !== "names" || !wheelEl.value) {
    nameScale.value = 1;
    return;
  }
  const baseItems = props.wheel.items ?? [props.wheel.target];
  const items =
    restarting.value && restartOriginValue.value
      ? [...baseItems, restartOriginValue.value]
      : baseItems;
  const root = wheelEl.value;
  const width = root.clientWidth;
  if (!items.length || width <= 0) return;

  const style = getComputedStyle(root);
  const fontSize = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) return;

  let maxWidth = 0;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = `700 ${fontSize}px ${style.fontFamily}`;
    for (const item of items) {
      maxWidth = Math.max(maxWidth, context.measureText(item).width);
    }
  } catch {
    return;
  }
  if (!maxWidth) {
    nameScale.value = 1;
    return;
  }

  // O padding lateral é 0.25em de cada lado; o centro ainda recebe os zooms
  // de linha e de texto no estado assentado.
  const available = width - fontSize * 0.5;
  const scaledWidth = maxWidth * CENTER_TEXT_SCALE * CENTER_ROW_SCALE;
  nameScale.value = available > 0 && scaledWidth > 0 ? Math.min(1, available / scaledWidth) : 1;
}

watch(
  () => [
    props.wheel.mode,
    props.wheel.items,
    props.wheel.target,
    restarting.value,
    restartOriginValue.value,
    props.fontKey,
  ],
  () => nextTick(updateNameScale),
  { immediate: true }
);

let resizeObserver: ResizeObserver | null = null;
const refitNames = () => nextTick(updateNameScale);

onMounted(() => {
  refitNames();
  if (typeof ResizeObserver !== "undefined" && wheelEl.value) {
    resizeObserver = new ResizeObserver(refitNames);
    resizeObserver.observe(wheelEl.value);
  }
  document.fonts?.addEventListener?.("loadingdone", refitNames);
  void document.fonts?.ready?.then(refitNames);
});

// Guarda que o estado assentado foi visto antes do próximo run_id. O watcher
// não limpa no false: o novo sorteio precisa saber de onde veio ao iniciar.
watch(
  settled,
  (value) => {
    if (value) {
      wasSettled = true;
      settledValue = valueAt(targetIndex.value);
    }
  },
  { immediate: true }
);

// Editar o nome sorteado mantém o wheel montado; atualiza a origem do próximo
// reinício para ele não voltar ao texto antigo.
watch(
  () => [props.wheel.target, props.wheel.items],
  () => {
    if (settled.value) settledValue = valueAt(targetIndex.value);
  }
);

watch(() => props.wheel.run_id, start, { immediate: true });
onBeforeUnmount(() => {
  stop();
  resizeObserver?.disconnect();
  document.fonts?.removeEventListener?.("loadingdone", refitNames);
});
</script>

<style scoped>
/* Moldura/visão 3D do picker; o giro acontece nos filhos. */
.draw-wheel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 100%;
  height: 6.7em;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  perspective: 560px;
  perspective-origin: 50% 50%;
  transform-style: preserve-3d;
  overflow: hidden;
  /* A roda é só visual: nunca deve capturar cliques da toolbar acima dela. */
  pointer-events: none;
}

/* Variante maior usada no fullscreen. */
.draw-wheel--large {
  height: 8.4em;
}

/* Janela que recorta a roda e aplica o fade nas extremidades. */
.draw-wheel__viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transform-style: preserve-3d;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 20%,
    black 80%,
    transparent 100%
  );
  mask-image: linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%);
}

/* Cada opção da roda, posicionada em 3D pelo deslocamento atual. */
.draw-wheel__row {
  position: absolute;
  transform-style: preserve-3d;
  top: 50%;
  left: 0;
  right: 0;
  display: block;
  overflow: visible;
  padding: 0 0.25em;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform-origin: center center;
  will-change: transform, opacity;
  backface-visibility: hidden;
}

/* Destaque da opção que está passando pelo centro. */
.draw-wheel__row--center {
  font-weight: 700;
}

/* Texto interno: recebe o zoom/fade sem perder o posicionamento 3D da linha. */
.draw-wheel__row-text {
  display: inline-block;
  font-size: calc(1em * var(--draw-name-scale, 1));
  transition:
    opacity var(--wheel-transition-ms, 380ms) var(--lj-ease, ease),
    transform var(--wheel-transition-ms, 380ms) var(--lj-ease, ease);
  will-change: opacity, transform;
}

/* Resultado assentado: opções vizinhas desaparecem encolhendo. */
.draw-wheel--settled .draw-wheel__row:not(.draw-wheel__row--center) .draw-wheel__row-text {
  opacity: 0;
  transform: scale(0.55);
}

.draw-wheel__row--center .draw-wheel__row-text {
  transition:
    opacity 500ms var(--lj-ease, ease),
    transform 820ms var(--lj-ease, ease);
}

.draw-wheel--settled .draw-wheel__row--center .draw-wheel__row-text {
  transform: scale(1.5);
}

/* O número anterior continua em 1.5 e diminui enquanto a roda recomeça. A
   marca é feita pelo valor, pois ele muda de slot durante o giro. */
@keyframes draw-wheel-origin-out {
  0% {
    opacity: 1;
    transform: scale(1.5);
  }
  65% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}

/* As opções ocultas voltam do estado encolhido junto com o novo sorteio. */
@keyframes draw-wheel-options-in {
  from {
    opacity: 0;
    transform: scale(0.55);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.draw-wheel--restarting .draw-wheel__row--restart-origin .draw-wheel__row-text {
  opacity: 0;
}

/* Enquanto o número sorteado ainda está no overlay, a linha central da roda
   fica oculta para não desenhar dois números no mesmo lugar. Ao remover a
   classe, a transição de opacidade faz esse número aparecer em 500ms. */
.draw-wheel--restart-overlay .draw-wheel__row--center .draw-wheel__row-text {
  opacity: 0;
  transition: none;
}

/* Número anterior centralizado acima da roda em movimento. */
.draw-wheel__origin {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.draw-wheel__origin-text {
  display: inline-block;
  font-size: calc(1em * var(--draw-name-scale, 1));
  max-width: 100%;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  animation: draw-wheel-origin-out var(--draw-restart-ms, 520ms) var(--lj-ease, ease) both;
}

.draw-wheel--restarting
  .draw-wheel__row:not(.draw-wheel__row--center):not(.draw-wheel__row--restart-origin)
  .draw-wheel__row-text {
  animation: draw-wheel-options-in var(--wheel-transition-ms, 180ms) var(--lj-ease, ease) both;
}

/* Faixa central que some quando o resultado assenta. */
.draw-wheel__band {
  position: absolute;
  left: 5%;
  right: 5%;
  top: 50%;
  height: 1.18em;
  transform: translateY(-50%);
  border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: color-mix(in srgb, currentColor 7%, transparent);
  pointer-events: none;
  transition: opacity 520ms var(--lj-ease, ease);
}

.draw-wheel--settled .draw-wheel__band {
  opacity: 0;
}
</style>
