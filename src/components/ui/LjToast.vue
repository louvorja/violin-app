<template>
  <Teleport to="body">
    <Transition name="lj-toast">
      <div
        v-if="modelValue"
        class="lj-toast"
        :class="[`lj-toast--${variant}`, { 'lj-toast--clickable': clickable }]"
        :role="variant === 'error' ? 'alert' : 'status'"
        :aria-live="variant === 'error' ? 'assertive' : 'polite'"
        @click="onClick"
        @mouseenter="pause"
        @mouseleave="resume"
      >
        <Icon v-if="icon" :icon="icon" :size="17" class="lj-toast__icon" />
        <span class="lj-toast__text">{{ text }}</span>
        <button
          v-if="dismissible"
          type="button"
          class="lj-toast__close"
          :aria-label="t('actions.close')"
          @click.stop="close"
        >
          <Icon :icon="ICONS.ACTIONS.CLOSE" :size="14" />
        </button>
        <div v-if="timeout > 0" class="lj-toast__timer" :style="timerStyle" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    text?: string;
    variant?: "info" | "success" | "warning" | "error";
    icon?: string;
    /** Milissegundos até fechar sozinho. 0 mantém aberto até fecharem. */
    timeout?: number;
    dismissible?: boolean;
    /** Toda a área vira alvo de clique — usado quando o aviso leva a algum lugar. */
    clickable?: boolean;
  }>(),
  { variant: "info", timeout: 4000, dismissible: true }
);

const emit = defineEmits<{ "update:modelValue": [value: boolean]; click: [] }>();

const { t } = useI18n();

let timer: ReturnType<typeof setTimeout> | null = null;
const paused = ref(false);

function clear(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function start(): void {
  clear();
  if (props.timeout > 0) timer = setTimeout(close, props.timeout);
}

// Ler um aviso leva tempo; com o ponteiro em cima ele não some no meio da leitura.
function pause(): void {
  paused.value = true;
  clear();
}

function resume(): void {
  paused.value = false;
  start();
}

function close(): void {
  clear();
  emit("update:modelValue", false);
}

function onClick(): void {
  if (props.clickable) emit("click");
}

watch(
  () => props.modelValue,
  (open) => (open ? start() : clear()),
  { immediate: true }
);

watch(() => props.timeout, start);

onBeforeUnmount(clear);

const timerStyle = computed(() => ({
  animationDuration: `${props.timeout}ms`,
  animationPlayState: paused.value ? "paused" : "running",
}));
</script>

<!-- Sem `scoped`: o conteúdo é teleportado para o <body> e não recebe o
     atributo de escopo. O isolamento vem do prefixo `lj-`. -->
<style>
.lj-toast {
  position: fixed;
  z-index: var(--lj-z-toast);
  bottom: var(--lj-space-7);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  max-width: min(560px, calc(100vw - var(--lj-space-8)));
  padding: var(--lj-space-4) var(--lj-space-5);
  overflow: hidden;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-float-border);
  border-left: 3px solid var(--lj-info);
  border-radius: var(--lj-radius-md);
  box-shadow: var(--lj-shadow-3);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
  line-height: 1.45;
}

/* A cor vive na borda e no ícone, não no fundo inteiro: sobre a projeção, um
   bloco chapado de cor chama mais atenção que o conteúdo do culto. */
.lj-toast--info {
  border-left-color: var(--lj-info);
}
.lj-toast--info .lj-toast__icon {
  color: var(--lj-info);
}
.lj-toast--success {
  border-left-color: var(--lj-success);
}
.lj-toast--success .lj-toast__icon {
  color: var(--lj-success);
}
.lj-toast--warning {
  border-left-color: var(--lj-warning);
}
.lj-toast--warning .lj-toast__icon {
  color: var(--lj-warning);
}
.lj-toast--error {
  border-left-color: var(--lj-danger);
}
.lj-toast--error .lj-toast__icon {
  color: var(--lj-alert-error-color, var(--lj-danger));
}

.lj-toast--clickable {
  cursor: pointer;
}
.lj-toast--clickable:hover {
  background: var(--lj-surface-bg-hover);
}

.lj-toast__icon {
  flex-shrink: 0;
}

.lj-toast__text {
  flex: 1;
  min-width: 0;
}

.lj-toast__close {
  display: inline-flex;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-text-subtle);
  cursor: pointer;
  border-radius: var(--lj-radius-xs);
}
.lj-toast__close:hover {
  color: var(--lj-text);
}
.lj-toast__close:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.lj-toast__timer {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: currentColor;
  opacity: 0.25;
  transform-origin: left;
  animation: lj-toast-timer linear forwards;
}

@keyframes lj-toast-timer {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.lj-toast-enter-active,
.lj-toast-leave-active {
  transition:
    opacity var(--lj-transition-normal),
    transform var(--lj-transition-normal);
}
.lj-toast-enter-from,
.lj-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (prefers-reduced-motion: reduce) {
  .lj-toast__timer {
    animation: none;
  }
}
</style>
