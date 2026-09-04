<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="lj-dialog__overlay" />
      <DialogContent
        class="lj-dialog"
        :class="`lj-dialog--${size}`"
        v-bind="description ? {} : { 'aria-describedby': undefined }"
        @open-auto-focus="onOpenAutoFocus"
        @escape-key-down="onDismiss"
        @pointer-down-outside="onDismiss"
        @interact-outside="onDismiss"
      >
        <header class="lj-dialog__header">
          <Icon
            v-if="icon"
            :icon="icon"
            :size="16"
            class="lj-dialog__icon"
            :class="iconVariant && `lj-dialog__icon--${iconVariant}`"
          />
          <DialogTitle class="lj-dialog__title">{{ title }}</DialogTitle>
          <DialogClose v-if="!persistent" class="lj-dialog__close" :aria-label="t('actions.close')">
            <Icon :icon="ICONS.ACTIONS.CLOSE" :size="15" />
          </DialogClose>
        </header>

        <DialogDescription v-if="description" class="lj-dialog__description">
          {{ description }}
        </DialogDescription>

        <div class="lj-dialog__body"><slot /></div>

        <footer v-if="$slots.footer" class="lj-dialog__footer"><slot name="footer" /></footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    title: string;
    description?: string;
    icon?: string;
    /** Tinge o ícone do cabeçalho — use para diferenciar aviso, risco e êxito. */
    iconVariant?: "info" | "success" | "warning" | "danger";
    size?: "sm" | "md" | "lg";
    /** Sem botão de fechar — a saída tem de ser por uma ação do rodapé. */
    persistent?: boolean;
  }>(),
  { size: "md" }
);

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const open = computed({
  get: () => !!props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

// O foco automático no primeiro elemento faz o campo já abrir selecionado,
// o que atrapalha em diálogos de confirmação. O contêiner recebe o foco e a
// navegação por Tab segue funcionando.
function onOpenAutoFocus(event: Event): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus?.();
}

// `persistent` promete que só uma ação do rodapé fecha o diálogo. Sem barrar
// estas saídas, Escape e clique fora fechavam assim mesmo — e o chamador
// perdia o efeito colateral que esperava rodar no fechamento.
function onDismiss(event: Event): void {
  if (props.persistent) event.preventDefault();
}
</script>

<!-- Sem `scoped`: o conteúdo vai para um portal no <body> e o Vue não propaga
     o atributo de escopo para lá, então regras scoped simplesmente não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
.lj-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: 2500;
  background: var(--lj-black-alpha-40);
  animation: lj-dialog-fade var(--lj-transition-normal);
}

.lj-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 2501;
  display: flex;
  flex-direction: column;
  transform: translate(-50%, -50%);
  max-height: 85vh;
  width: calc(100vw - var(--lj-space-8));
  background: var(--lj-surface-bg);
  border: var(--lj-ui-float-border);
  border-radius: var(--lj-radius-lg);
  box-shadow: var(--lj-shadow-3);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
  outline: none;
  animation: lj-dialog-in var(--lj-transition-normal);
}

.lj-dialog--sm {
  max-width: 380px;
}
.lj-dialog--md {
  max-width: 560px;
}
.lj-dialog--lg {
  max-width: 860px;
}

.lj-dialog__header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-5) var(--lj-space-6);
  border-bottom: 1px solid var(--lj-surface-divider);
}

.lj-dialog__icon {
  color: var(--lj-text-muted);
}

.lj-dialog__icon--info {
  color: var(--lj-info);
}
.lj-dialog__icon--success {
  color: var(--lj-success);
}
.lj-dialog__icon--warning {
  color: var(--lj-warning);
}
.lj-dialog__icon--danger {
  color: var(--lj-alert-error-color, var(--lj-danger));
}

.lj-dialog__title {
  margin: 0;
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-semibold);
}

.lj-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-muted);
  cursor: pointer;
}
.lj-dialog__close:hover {
  background: var(--lj-surface-bg-hover);
  color: var(--lj-text);
}
.lj-dialog__close:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.lj-dialog__description {
  margin: 0;
  padding: var(--lj-space-5) var(--lj-space-6) 0;
  color: var(--lj-text-muted);
  line-height: 1.5;
}

.lj-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--lj-space-6);
}

.lj-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4) var(--lj-space-6);
  border-top: 1px solid var(--lj-surface-divider);
  background: var(--lj-surface-bg-soft);
}

@keyframes lj-dialog-fade {
  from {
    opacity: 0;
  }
}

@keyframes lj-dialog-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 6px));
  }
}
</style>
