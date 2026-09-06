<template>
  <LjTooltip v-if="tooltipText" :text="tooltipText">
    <button v-bind="buttonBindings">
      <LjSpinner v-if="loading" :size="iconSize" />
      <LjIcon v-else-if="icon" :icon="icon" :size="iconSize" />
      <span v-if="!iconOnly" class="lj-btn__label"><slot /></span>
      <LjIcon v-if="iconEnd && !iconOnly" :icon="iconEnd" :size="iconSize" />
    </button>
  </LjTooltip>

  <button v-else v-bind="buttonBindings">
    <LjSpinner v-if="loading" :size="iconSize" />
    <LjIcon v-else-if="icon" :icon="icon" :size="iconSize" />
    <span v-if="!iconOnly" class="lj-btn__label"><slot /></span>
    <LjIcon v-if="iconEnd && !iconOnly" :icon="iconEnd" :size="iconSize" />
  </button>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { computed, useAttrs } from "vue";
import LjSpinner from "./LjSpinner.vue";
import LjTooltip from "./LjTooltip.vue";
import type { UiSize } from "./types";
import { ICON_SIZE } from "./types";

const props = withDefaults(
  defineProps<{
    variant?: "default" | "primary" | "ghost" | "danger" | "subtle";
    size?: UiSize;
    icon?: string;
    iconEnd?: string;
    iconOnly?: boolean;
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  { variant: "default", size: "md", type: "button" }
);

const iconSize = computed(() => ICON_SIZE[props.size]);

// O botão é o alvo dos atributos, não o invólucro do tooltip.
defineOptions({ inheritAttrs: false });
const attrs = useAttrs();

/**
 * Ícone sozinho não diz o que faz. O `title` nativo até diz, mas só depois de
 * um segundo parado e com a moldura do sistema — num app conduzido ao vivo o
 * operador desiste antes.
 *
 * O template repete o `<button>` nos dois ramos de propósito: sem tooltip ele
 * precisa continuar sendo a raiz do componente, ou `class`, `:deep()` e o
 * `as-child` da Reka passariam a mirar um invólucro em cada consumidor. Pelo
 * mesmo motivo não há comentário entre os dois ramos — um nó de comentário no
 * topo faria o componente virar multi-root.
 */
const tooltipText = computed(() => {
  // Botão desabilitado não emite eventos de ponteiro, então o tooltip do Reka
  // nunca abriria: ali o `title` nativo fica, lento mas presente — melhor que
  // um ícone apagado que não diz o que é.
  if (props.disabled || props.loading) return undefined;
  return props.iconOnly && typeof attrs.title === "string" && attrs.title ? attrs.title : undefined;
});

const buttonBindings = computed(() => {
  // O título vira tooltip do design system e sai do DOM: os dois juntos
  // apareceriam empilhados. Sem rótulo visível, ele ainda serve de nome
  // acessível quando o chamador não passou um aria-label próprio.
  const { title, ...rest } = attrs;
  return {
    ...(tooltipText.value ? rest : attrs),
    class: [
      "lj-ui-control",
      "lj-btn",
      `lj-ui-size-${props.size}`,
      `lj-btn--${props.variant}`,
      { "lj-btn--icon": props.iconOnly, "lj-btn--block": props.block },
      attrs.class,
    ],
    type: props.type,
    disabled: props.disabled || props.loading,
    "aria-busy": props.loading || undefined,
    "aria-label": (attrs["aria-label"] as string) || tooltipText.value || (title as string),
  };
});
</script>

<style scoped>
.lj-btn {
  justify-content: center;
  cursor: pointer;
  font-weight: var(--lj-weight-medium);
  white-space: nowrap;
  user-select: none;
}

.lj-btn__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.lj-btn--block {
  display: flex;
  width: 100%;
}

/* Botão só-ícone é quadrado: largura = altura, sem padding lateral */
.lj-btn--icon {
  padding-inline: 0;
  aspect-ratio: 1;
}

.lj-btn--default:hover {
  background: var(--lj-surface-bg-hover);
}
.lj-btn--default:active {
  background: var(--lj-surface-bg-active);
}

.lj-btn--primary {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}
.lj-btn--primary:hover {
  background: var(--lj-ui-accent-hover);
  border-color: var(--lj-ui-accent-hover);
}
.lj-btn--primary:active {
  background: var(--lj-ui-accent-press);
  border-color: var(--lj-ui-accent-press);
}

.lj-btn--danger {
  border-color: var(--lj-danger-border);
  color: var(--lj-danger);
}
.lj-btn--danger:hover {
  background: var(--lj-danger-soft);
  border-color: var(--lj-danger);
}

/* Ghost some até o hover — para barras de ferramenta densas */
.lj-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--lj-text-muted);
}
.lj-btn--ghost:hover {
  background: var(--lj-surface-bg-hover);
  color: var(--lj-text);
}

/* Subtle mantém a superfície, mas sem traço — para agrupamentos */
.lj-btn--subtle {
  background: var(--lj-surface-bg-soft);
  border-color: transparent;
}
.lj-btn--subtle:hover {
  background: var(--lj-surface-bg-hover);
}
</style>
