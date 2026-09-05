<template>
  <!-- Temporário: sobreposição modal de verdade — foco preso, Esc e clique fora
       vêm do Dialog da Reka, que também leva o painel para um portal no <body>. -->
  <DialogRoot v-if="temporary" v-model:open="aberto">
    <DialogPortal>
      <DialogOverlay class="lj-drawer__overlay" />
      <DialogContent
        class="lj-drawer lj-drawer--temporary"
        :class="`lj-drawer--${side}`"
        :style="estilo"
        v-bind="{ ...semAriaOrfa(!!title), ...$attrs }"
        @open-auto-focus="focarPainel"
      >
        <header class="lj-drawer__header">
          <slot name="header">
            <DialogTitle class="lj-drawer__title">{{ title }}</DialogTitle>
          </slot>
          <!-- Com cabeçalho próprio o DialogTitle visível não existe, e a Reka
               avisa no console a cada montagem porque procura o contexto dele,
               não um nome acessível — um aria-label no painel não a satisfaz. -->
          <VisuallyHidden v-if="$slots.header" as-child>
            <DialogTitle>{{ title }}</DialogTitle>
          </VisuallyHidden>
          <div v-if="$slots.actions" class="lj-drawer__actions"><slot name="actions" /></div>
          <DialogClose class="lj-drawer__close" :aria-label="t('actions.close')">
            <Icon :icon="ICONS.ACTIONS.CLOSE" :size="14" />
          </DialogClose>
        </header>
        <div class="lj-drawer__body"><slot /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- Permanente: fica no fluxo, ocupa largura e empurra o que está ao lado.
       Sem overlay e sem trava de foco — não há nada para dispensar. -->
  <Transition v-else name="lj-drawer-push">
    <aside
      v-if="aberto"
      class="lj-drawer lj-drawer--permanent"
      :class="`lj-drawer--${side}`"
      :style="estilo"
      v-bind="$attrs"
    >
      <header v-if="title || $slots.header || $slots.actions" class="lj-drawer__header">
        <slot name="header">
          <span class="lj-drawer__title">{{ title }}</span>
        </slot>
        <div v-if="$slots.actions" class="lj-drawer__actions"><slot name="actions" /></div>
      </header>
      <div class="lj-drawer__body"><slot /></div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  VisuallyHidden,
} from "reka-ui";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

defineOptions({
  // As duas formas do painel têm raiz diferente (portal x fluxo), e no modo
  // permanente fechado não existe raiz nenhuma. Herança automática de atributo
  // acabaria descartando `class` do consumidor com aviso no console.
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    /** De que borda o painel entra. Também define de que lado fica o traço. */
    side?: "left" | "right";
    /** Número vira px; string passa direto (`"30%"`, `"18rem"`). */
    width?: number | string;
    /** Sobrepõe com overlay e fecha no Esc/clique fora. Sem isto, empurra o conteúdo. */
    temporary?: boolean;
    /**
     * Vira o cabeçalho e, no modo temporário, o nome acessível do painel.
     * Continua valendo com o slot `header`: ali o título vira um rótulo
     * invisível, para o painel não abrir sem nome.
     */
    title?: string;
  }>(),
  { side: "left", width: 240 }
);

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const { t } = useI18n();

const aberto = computed({
  get: () => !!props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

// A Reka aponta aria-labelledby e aria-describedby para ids que ela reserva,
// existam ou não os elementos. Id órfão faz o leitor de tela anunciar o painel
// sem nome nenhum — pior do que não ter o atributo. Descrição o drawer nunca
// tem; título existe sempre que `title` foi passado, visível ou invisível.
function semAriaOrfa(temTitulo: boolean): Record<string, undefined> {
  return temTitulo
    ? { "aria-describedby": undefined }
    : { "aria-describedby": undefined, "aria-labelledby": undefined };
}

const estilo = computed(
  () =>
    ({
      "--lj-drawer-w": typeof props.width === "number" ? `${props.width}px` : props.width,
    }) as Record<string, string>
);

// Mesmo acordo do LjDialog: focar o primeiro campo abre o painel com um
// textarea já selecionado, o que atrapalha quem só queria olhar. O contêiner
// recebe o foco e o Tab segue a partir dali.
function focarPainel(event: Event): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus?.();
}
</script>

<!-- Sem `scoped`: no modo temporário o painel vai para um portal no <body> e o
     Vue não carimba o atributo de escopo lá, então regras scoped não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
.lj-drawer {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: var(--lj-drawer-w, 240px);
  /* Recorta o conteúdo enquanto a largura vai a zero na saída do modo
     permanente, e segura painéis internos mais largos que a coluna. */
  overflow: hidden;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
  outline: none;
}

.lj-drawer--left {
  border-right: var(--lj-ui-border);
}
.lj-drawer--right {
  border-left: var(--lj-ui-border);
}

.lj-drawer--permanent {
  flex: 0 0 auto;
  align-self: stretch;
}

.lj-drawer--temporary {
  position: fixed;
  top: 0;
  bottom: 0;
  z-index: calc(var(--lj-z-dialog) + 1);
  max-width: 100vw;
  box-shadow: var(--lj-shadow-3);
}
.lj-drawer--temporary.lj-drawer--left {
  left: 0;
}
.lj-drawer--temporary.lj-drawer--right {
  right: 0;
}

.lj-drawer__header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-2) var(--lj-space-4) var(--lj-space-2) var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-divider);
  background: var(--lj-surface-bg-soft);
}

.lj-drawer__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--lj-text-muted);
}

.lj-drawer__actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
}

.lj-drawer__close {
  /* O empurrão para a borda vinha do `flex: 1` do título, que deixa de existir
     quando o cabeçalho vem por slot. */
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-muted);
  cursor: pointer;
}
.lj-drawer__close:hover {
  background: var(--lj-surface-bg-hover);
  color: var(--lj-text);
}
.lj-drawer__close:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* Sem padding de propósito: o que entra aqui costuma trazer o próprio
   espaçamento (FormatPanel, listas que sangram até a borda). */
.lj-drawer__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.lj-drawer__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--lj-z-dialog);
  background: var(--lj-black-alpha-40);
}

/* ---------------------------------------------------------------------------
 * Movimento
 *
 * Mesmo par de tempos das demais camadas flutuantes (--lj-ui-float-enter /
 * --lj-ui-float-exit), só que o percurso aqui é a largura inteira do painel:
 * o deslocamento curto do menu não leria como um painel chegando da borda.
 * ------------------------------------------------------------------------- */
.lj-drawer--left {
  --lj-drawer-from: -100%;
}
.lj-drawer--right {
  --lj-drawer-from: 100%;
}

.lj-drawer--temporary[data-state="open"] {
  animation: lj-drawer-in var(--lj-ui-float-enter);
}
.lj-drawer--temporary[data-state="closed"] {
  animation: lj-drawer-out var(--lj-ui-float-exit);
}

.lj-drawer__overlay[data-state="open"] {
  animation: lj-drawer-fade-in var(--lj-ui-float-enter);
}
.lj-drawer__overlay[data-state="closed"] {
  animation: lj-drawer-fade-out var(--lj-ui-float-exit);
}

@keyframes lj-drawer-in {
  from {
    transform: translateX(var(--lj-drawer-from));
  }
}
@keyframes lj-drawer-out {
  to {
    transform: translateX(var(--lj-drawer-from));
  }
}
@keyframes lj-drawer-fade-in {
  from {
    opacity: 0;
  }
}
@keyframes lj-drawer-fade-out {
  to {
    opacity: 0;
  }
}

/* No modo permanente não há o que deslizar sobre: o painel abre espaço, então
   quem anima é a largura — o conteúdo ao lado acompanha em vez de saltar.
   Estas regras vêm depois de .lj-drawer de propósito: mesma especificidade,
   ganham por ordem e zeram a largura declarada lá. */
.lj-drawer-push-enter-active {
  transition: width var(--lj-ui-float-enter);
}
.lj-drawer-push-leave-active {
  transition: width var(--lj-ui-float-exit);
}
.lj-drawer-push-enter-from,
.lj-drawer-push-leave-to {
  width: 0;
  border-width: 0;
}

/* A Reka só desmonta o painel no animationend — mas `animation: none` ela
   trata como "não há animação" e desmonta na hora, então zerar aqui é seguro.
   Os seletores repetem a especificidade dos de cima para vencer por ordem. */
@media (prefers-reduced-motion: reduce) {
  .lj-drawer--temporary[data-state],
  .lj-drawer__overlay[data-state] {
    animation: none;
  }
  .lj-drawer-push-enter-active,
  .lj-drawer-push-leave-active {
    transition: none;
  }
}
</style>
