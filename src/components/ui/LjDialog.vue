<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="lj-dialog__overlay" :style="layerStyle" />
      <DialogContent
        class="lj-dialog"
        :style="layerStyle"
        :class="[`lj-dialog--${size}`, { 'lj-dialog--module': allowGlobalHotkeys }]"
        v-bind="description ? {} : { 'aria-describedby': undefined }"
        @open-auto-focus="onOpenAutoFocus"
        @escape-key-down="onDismiss"
        @pointer-down-outside="onDismiss"
        @interact-outside="onDismiss"
      >
        <header class="lj-dialog__header">
          <LjIcon
            v-if="icon"
            :icon="icon"
            :size="16"
            class="lj-dialog__icon"
            :class="iconVariant && `lj-dialog__icon--${iconVariant}`"
          />
          <DialogTitle class="lj-dialog__title">
            <span :aria-hidden="accessibleTitle ? true : undefined">{{ title }}</span>
            <span v-if="accessibleTitle" class="lj-dialog__accessible-title">
              {{ accessibleTitle }}
            </span>
          </DialogTitle>
          <DialogClose v-if="!persistent" class="lj-dialog__close" :aria-label="t('actions.close')">
            <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="15" />
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
import { LjIcon } from "@/components/ui";
import { computed, onScopeDispose, ref, watch } from "vue";
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
import { acquireDialogLevel, releaseDialogLevel } from "./dialogStack";
import { ICONS } from "@/config/Icons";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    title: string;
    /** Nome anunciado por leitores de tela quando o título visual é genérico. */
    accessibleTitle?: string;
    /** Mantém atalhos globais em diálogos que representam uma janela de módulo. */
    allowGlobalHotkeys?: boolean;
    description?: string;
    icon?: string;
    /** Tinge o ícone do cabeçalho — use para diferenciar aviso, risco e êxito. */
    iconVariant?: "info" | "success" | "warning" | "danger";
    size?: "sm" | "md" | "lg";
    /** Sem botão de fechar — a saída tem de ser por uma ação do rodapé. */
    persistent?: boolean;
  }>(),
  { accessibleTitle: "", size: "md" }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  openAutoFocus: [event: Event];
}>();

const open = computed({
  get: () => !!props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

/**
 * Nível na pilha de diálogos abertos. É automático de propósito: um diálogo
 * que abre outro é o caso comum (gerenciador sobre formulário, form de
 * categoria sobre o gerenciador) e o gerenciamento de quem fica sobre quem
 * fica agnóstico para o usuario do componente. Veja `dialogStack.ts` para
 * entender melhor.
 */
const nivelToken = Symbol("lj-dialog");
const nivel = ref(0);

// `immediate` cobre o diálogo que já começa aberto.
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      nivel.value = acquireDialogLevel(nivelToken);
      return;
    }
    releaseDialogLevel(nivelToken);
    nivel.value = 0;
  },
  { immediate: true }
);

// Um diálogo desmontado por `v-if` enquanto aberto não passa pelo watcher, e
// sem isto o nível ficaria reservado para sempre.
onScopeDispose(() => releaseDialogLevel(nivelToken));

const layerStyle = computed(() => ({ "--lj-dialog-stack": String(nivel.value) }));

// O foco automático no primeiro elemento faz o campo já abrir selecionado,
// o que atrapalha em diálogos de confirmação. O contêiner recebe o foco e a
// navegação por Tab segue funcionando.
function onOpenAutoFocus(event: Event): void {
  emit("openAutoFocus", event);
  if (event.defaultPrevented) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus?.();
}

// `persistent` promete que só uma ação do rodapé fecha o diálogo. Sem barrar
// estas saídas, Escape e clique fora fechavam assim mesmo — e o chamador
// perdia o efeito colateral que esperava rodar no fechamento.
function onDismiss(event: Event): void {
  // O alerta é teleportado para o <body>: para a Reka, responder a ele é um
  // clique fora, e o diálogo fecharia junto com a pergunta que ele abriu.
  const target = (event as CustomEvent).detail?.originalEvent?.target;
  const fromAlert = target instanceof Element && !!target.closest(".alert-overlay");
  if (props.persistent || fromAlert) event.preventDefault();
}
</script>

<!-- Sem `scoped`: o conteúdo vai para um portal no <body> e o Vue não propaga
     o atributo de escopo para lá, então regras scoped simplesmente não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
/* Passo 2 por nível porque cada diálogo ocupa DOIS níveis — o overlay e o
   conteúdo. O overlay do diálogo do topo precisa cobrir o conteúdo do de baixo;
   com passo 1 ele ficaria atrás dele e o diálogo de baixo pareceria "na
   frente" sem estar. A folga até `--lj-z-popup` é de 49 níveis, então um
   diálogo empilhado nunca cobre um painel flutuante (select dentro de
   diálogo é caso corriqueiro). */
.lj-dialog__overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--lj-z-dialog) + var(--lj-dialog-stack, 0) * 2);
  background: var(--lj-black-alpha-40);
  animation: lj-dialog-fade var(--lj-ui-float-enter);
}

/* Sem par de saída o diálogo some seco, enquanto menu, select e popover saem
   animados — o mesmo gesto de fechar tinha duas resoluções diferentes na tela.
   Os tokens de entrada e saída são deliberadamente assimétricos: quem chega
   desacelera, quem sai acelera. */
.lj-dialog__overlay[data-state="closed"] {
  animation: lj-dialog-fade-out var(--lj-ui-float-exit);
}

.lj-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: calc(var(--lj-z-dialog) + 1 + var(--lj-dialog-stack, 0) * 2);
  display: flex;
  flex-direction: column;
  transform: translate(-50%, -50%);
  max-height: 85vh;
  width: calc(100vw - var(--lj-space-8));
  background: var(--lj-surface-bg);
  border: var(--lj-ui-float-border);
  border-radius: var(--lj-radius-lg);
  /* Recorta os cantos: o rodapé e o cabeçalho têm fundo próprio e vão de ponta
     a ponta, então sem isto o retângulo deles aparece por fora da curva. Nada
     dentro do diálogo depende de transbordar — o corpo já rola sozinho, e
     select, menu e popover saem por portal, fora deste elemento.
  */
  overflow: hidden;
  box-shadow: var(--lj-shadow-3);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
  outline: none;
  animation: lj-dialog-in var(--lj-ui-float-enter);
}

.lj-dialog[data-state="closed"] {
  animation: lj-dialog-out var(--lj-ui-float-exit);
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

.lj-dialog__accessible-title {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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

@media (max-width: 600px) {
  .lj-dialog__footer {
    flex-wrap: wrap;
    padding-inline: var(--lj-space-4);
    padding-bottom: calc(var(--lj-space-4) + env(safe-area-inset-bottom, 0px));
  }

  .lj-dialog__footer > button,
  .lj-dialog__footer > [role="button"] {
    min-height: 44px;
  }
}

@keyframes lj-dialog-fade {
  from {
    opacity: 0;
  }
}

@keyframes lj-dialog-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + var(--lj-ui-float-shift))) scale(0.97);
  }
}

@keyframes lj-dialog-fade-out {
  to {
    opacity: 0;
  }
}

@keyframes lj-dialog-out {
  to {
    opacity: 0;
    transform: translate(-50%, calc(-50% + var(--lj-ui-float-shift))) scale(0.97);
  }
}
</style>
