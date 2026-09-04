<template>
  <hr
    v-if="!vertical"
    class="lj-divider"
    :class="{ 'lj-divider--inset': inset }"
    :role="semantic ? 'separator' : 'presentation'"
    :aria-hidden="semantic ? undefined : 'true'"
  />
  <span
    v-else
    class="lj-divider lj-divider--vertical"
    :role="semantic ? 'separator' : 'presentation'"
    aria-orientation="vertical"
    :aria-hidden="semantic ? undefined : 'true'"
  />
</template>

<script setup lang="ts">
// Divisória decorativa não entra na árvore de acessibilidade: um leitor de tela
// não ganha nada anunciando "separador" entre cada par de itens de uma lista.
// Quando ela realmente separa grupos distintos, passe `semantic`.
//
// O comentário mora aqui, e não no template: um comentário HTML no topo conta
// como nó raiz e transformaria o componente em multi-root.
defineProps<{
  vertical?: boolean;
  /** Recua as pontas, para divisórias dentro de listas com padding. */
  inset?: boolean;
  /** Anuncia como separador de verdade em vez de enfeite. */
  semantic?: boolean;
}>();
</script>

<style scoped>
.lj-divider {
  flex-shrink: 0;
  margin: 0;
  border: none;
  background: var(--lj-surface-divider);
  height: 1px;
  width: 100%;
}

.lj-divider--inset {
  width: auto;
  margin-inline: var(--lj-space-5);
}

.lj-divider--vertical {
  width: 1px;
  height: auto;
  align-self: stretch;
  min-height: 1em;
}
</style>
