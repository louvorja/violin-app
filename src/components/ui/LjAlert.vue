<template>
  <div
    class="lj-alert"
    :class="`lj-alert--${variant}`"
    :role="variant === 'danger' ? 'alert' : 'status'"
  >
    <Icon v-if="resolvedIcon" :icon="resolvedIcon" :size="16" class="lj-alert__icon" />
    <div class="lj-alert__body">
      <strong v-if="title" class="lj-alert__title">{{ title }}</strong>
      <div class="lj-alert__text">
        <slot>{{ text }}</slot>
      </div>
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="lj-alert__close"
      :aria-label="t('actions.close')"
      @click="$emit('dismiss')"
    >
      <Icon :icon="ICONS.ACTIONS.CLOSE" :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

const props = withDefaults(
  defineProps<{
    variant?: "info" | "success" | "warning" | "danger";
    title?: string;
    text?: string;
    /**
     * Ícone próprio; `null` remove o ícone.
     *
     * Não use `false` como sentinela aqui: o Vue faz casting de Boolean, e uma
     * prop cujo tipo inclui Boolean vira `false` quando não é passada — o
     * componente ficaria permanentemente sem ícone.
     */
    icon?: string | null;
    dismissible?: boolean;
  }>(),
  { variant: "info" }
);

defineEmits<{ dismiss: [] }>();

const { t } = useI18n();

const DEFAULT_ICONS = {
  info: ICONS.UI.INFORMATION_OUTLINE,
  success: ICONS.UI.CHECK,
  warning: ICONS.UI.ALERT,
  danger: ICONS.UI.ALERT,
} as const;

const resolvedIcon = computed(() =>
  props.icon === null ? null : (props.icon ?? DEFAULT_ICONS[props.variant])
);
</script>

<style scoped>
/* Mesma gramática do LjToast: a cor mora na borda e no ícone, não num fundo
   chapado — sobre a tela de projeção um bloco saturado compete com o conteúdo. */
.lj-alert {
  display: flex;
  align-items: flex-start;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4) var(--lj-space-5);
  border: 1px solid var(--lj-surface-border);
  border-left-width: 3px;
  border-radius: var(--lj-radius-sm);
  font-size: var(--lj-text-base);
  line-height: 1.5;
  color: var(--lj-text);
}

.lj-alert--info {
  background: var(--lj-active-bg);
  border-left-color: var(--lj-info);
}
.lj-alert--info .lj-alert__icon {
  color: var(--lj-info);
}

.lj-alert--success {
  background: var(--lj-success-soft);
  border-left-color: var(--lj-success);
}
.lj-alert--success .lj-alert__icon {
  color: var(--lj-success);
}

.lj-alert--warning {
  background: var(--lj-orange-alpha-12);
  border-left-color: var(--lj-warning);
}
.lj-alert--warning .lj-alert__icon {
  color: var(--lj-warning);
}

.lj-alert--danger {
  background: var(--lj-danger-soft);
  border-left-color: var(--lj-danger);
}
.lj-alert--danger .lj-alert__icon {
  color: var(--lj-alert-error-color, var(--lj-danger));
}

.lj-alert__icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.lj-alert__body {
  flex: 1;
  min-width: 0;
}

.lj-alert__title {
  display: block;
  font-weight: var(--lj-weight-semibold);
  margin-bottom: 2px;
}

.lj-alert__close {
  flex-shrink: 0;
  display: inline-flex;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-text-subtle);
  cursor: pointer;
  border-radius: var(--lj-radius-xs);
}
.lj-alert__close:hover {
  color: var(--lj-text);
}
.lj-alert__close:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
</style>
