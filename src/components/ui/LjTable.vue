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
    :tabindex="maxHeight ? 0 : undefined"
    :role="maxHeight ? 'region' : undefined"
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
    /**
     * Altura máxima (comprimento CSS). É o que dá rolagem vertical própria — e,
     * com ela, o contêiner entra na ordem de tabulação: uma área que rola sem
     * receber foco é intransponível para quem opera só com teclado, e no meio
     * de um culto não há mouse sobrando.
     */
    maxHeight?: string;
  }>(),
  { density: "compact" }
);
</script>

<style scoped>
.lj-table {
  /* Altura de linha, não padding. O `<v-table>` que existia aqui antes impunha
     36px na linha e 40px no cabeçalho por `height`, e as listas do app (músicas,
     hinário, bíblia, coletâneas) foram desenhadas em cima disso. Só com padding
     a linha cairia para ~27px: cabe mais linha na mesma altura, a lista encolhe
     um quarto e o scroll infinito passa a pedir página em outro ritmo. */
  --lj-table-row-h: 36px;
  --lj-table-head-h: 40px;

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

  /* Em tabela, `height` vale como piso: a célula cresce se o conteúdo pedir. */
  .lj-table :deep(thead th) {
    height: var(--lj-table-head-h);
  }
  .lj-table :deep(tbody td) {
    height: var(--lj-table-row-h);
  }

  .lj-table--compact :deep(th) {
    padding: var(--lj-space-3) var(--lj-space-4);
  }
  .lj-table--compact :deep(td) {
    padding: var(--lj-space-2) var(--lj-space-4);
  }

  .lj-table--comfortable {
    --lj-table-row-h: 48px;
    --lj-table-head-h: 52px;
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
