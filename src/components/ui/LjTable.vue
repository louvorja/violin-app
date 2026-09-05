<template>
  <div
    class="lj-table"
    :class="[
      `lj-table--${density}`,
      {
        'lj-table--striped': striped,
        'lj-table--hover': hover,
        'lj-table--sticky': sticky,
      },
    ]"
    :style="maxHeight ? { maxHeight } : undefined"
  >
    <table class="lj-table__table">
      <slot />
    </table>
  </div>
</template>

<script setup lang="ts">
/**
 * Tabela de apresentação — só a moldura e o estilo das células.
 *
 * O conteúdo (thead, tbody, tr, th, td) vem inteiro por slot: busca, ordenação
 * e paginação continuam com quem usa. `DataTable.vue` é o exemplo vivo disso e
 * não deve ser absorvido aqui.
 */
withDefaults(
  defineProps<{
    /** Compacta por padrão: a densidade da shell é a do Delphi, não a do Material. */
    density?: "compact" | "comfortable";
    striped?: boolean;
    hover?: boolean;
    /**
     * Cabeçalho fixo. Só engata quando este contêiner é quem rola na vertical —
     * ou seja, com `maxHeight`, ou com altura vinda do pai. Sem isso a caixa
     * cresce com o conteúdo, quem rola é a página e o cabeçalho vai junto.
     */
    sticky?: boolean;
    /** Altura máxima (comprimento CSS). É o que dá rolagem vertical própria. */
    maxHeight?: string;
  }>(),
  { density: "compact" }
);
</script>

<style scoped>
.lj-table {
  width: 100%;
  /* Rolagem contida para a página nunca rolar de lado. Só o eixo X interessa,
     mas a regra do CSS arrasta o Y junto — com o X rolável, `visible` no Y vira
     `auto`. Por isso é `maxHeight` que decide se a tabela também rola na
     vertical, e por isso o cabeçalho fixo depende dele. */
  overflow: auto;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-size: var(--lj-text-base);
}

.lj-table__table {
  width: 100%;
  /* `separate` e não `collapse`: com as bordas colapsadas o traço do cabeçalho
     pertence à grade da tabela, e fica para trás quando o th gruda no topo. */
  border-collapse: separate;
  border-spacing: 0;
}

/* Daqui para baixo o alvo é conteúdo que veio do slot — e conteúdo de slot é
   compilado no escopo de quem chama, não neste. Sem `:deep()` o seletor sai
   carimbado com o atributo deste componente e não casa com célula nenhuma: o
   estilo todo falha calado.
   A camada resolve o outro lado do mesmo problema: regra fora de camada vence
   regra em camada, seja qual for a especificidade, então um `lj-u-text-end` no
   th derruba o padrão daqui sem precisar de !important. */
@layer lj-table {
  .lj-table :deep(th),
  .lj-table :deep(td) {
    text-align: left;
    vertical-align: middle;
  }

  .lj-table :deep(thead th) {
    background: var(--lj-surface-bg-soft);
    color: var(--lj-text-muted);
    font-size: var(--lj-text-xs);
    font-weight: var(--lj-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border-bottom: 1px solid var(--lj-surface-border-strong);
  }

  .lj-table :deep(tbody td) {
    border-bottom: 1px solid var(--lj-surface-divider);
  }

  .lj-table :deep(tbody tr) {
    transition: background var(--lj-transition-fast);
  }

  .lj-table--compact :deep(th) {
    padding: var(--lj-space-3) var(--lj-space-4);
  }
  .lj-table--compact :deep(td) {
    padding: var(--lj-space-2) var(--lj-space-4);
  }

  .lj-table--comfortable :deep(th) {
    padding: var(--lj-space-4) var(--lj-space-5);
  }
  .lj-table--comfortable :deep(td) {
    padding: var(--lj-space-3) var(--lj-space-5);
  }

  .lj-table--striped :deep(tbody tr:nth-child(even)) {
    background: var(--lj-surface-bg-soft);
  }

  /* Depois das listras de propósito: os dois seletores têm a mesma
     especificidade, e é a ordem que faz o realce vencer a listra. */
  .lj-table--hover :deep(tbody tr:hover) {
    background: var(--lj-surface-bg-hover);
  }

  .lj-table--sticky :deep(thead th) {
    position: sticky;
    top: 0;
    /* Empilha só acima das linhas desta tabela. Não é a escala de camadas do
       app (--lj-z-*), que ordena janelas flutuantes entre si. */
    z-index: 1;
  }
}
</style>
