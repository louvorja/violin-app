<template>
  <div
    class="pm-col-resize"
    :class="`pm-col-resize--${column}`"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :aria-label="tm('layout.resize_column')"
    :title="tm('layout.resize_column')"
    :data-testid="`pm-resize-${column}`"
    @pointerdown="(e: PointerEvent) => layout.start(column, e)"
    @keydown.left.prevent="layout.step(column, -1)"
    @keydown.right.prevent="layout.step(column, 1)"
    @dblclick="layout.reset(column)"
  />
</template>

<script setup lang="ts">
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { Column, useColumnLayout } from "../composables/useColumnLayout";

/**
 * Alça sobre a borda de uma coluna do módulo (programa ou saídas): arrastar,
 * setas com a alça em foco, ou duplo clique para voltar à largura padrão.
 * Fica direto na grade do módulo, por cima da borda da coluna.
 */

defineProps<{ column: Column; layout: ReturnType<typeof useColumnLayout> }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
</script>

<style scoped>
/* Faixa de pegar sobre a borda da coluna; o traço acende ao passar o mouse.
   Classe dobrada: vence o `.pm-area > *` (fundo, overflow) das colunas do módulo. */
.pm-col-resize.pm-col-resize {
  grid-row: 1 / 3;
  z-index: 3;
  width: 6px;
  overflow: visible;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
  /* O foco aparece no traço laranja, não no contorno da faixa. */
  outline: none;
  transition: background 120ms var(--lj-ease);
}

.pm-col-resize--program {
  grid-column: 1;
  justify-self: end;
  margin-right: -3px;
}

.pm-col-resize--outputs {
  grid-column: 3;
  justify-self: start;
  margin-left: -3px;
}

.pm-col-resize:hover,
.pm-col-resize:active,
.pm-col-resize:focus-visible {
  background: linear-gradient(var(--lj-orange), var(--lj-orange)) center / 2px 100% no-repeat;
}
</style>
