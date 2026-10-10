/**
 * @category helper-puro — Escreve a ordem de um arrasto na lista de anúncios.
 *
 * O problema que motivou separar isto do componente: `sorted` é um `computed`
 * que **lê `a.ordem`** de cada item e devolve um array novo. Lendo
 * `sorted.value` DENTRO do laço — como o código fazia —, a primeira escrita de
 * `ordem` suja o computed, e a leitura seguinte já devolveria a lista
 * reordenada pelos `ordem`s parciais: os índices mudavam debaixo dos pés e o
 * valor ia para o item errado. O resultado era o sintoma relatado — soltava o
 * arrasto e a ordem não mudava.
 *
 * A regra é uma só: **uma leitura só, antes de qualquer escrita.**
 *
 * `leia` é uma função de propósito: é ela que no componente é `() => sorted.value`,
 * e é o que permite testar aqui o pior caso (o array que reordena a cada leitura)
 * sem montar o componente nem depender do Sortable.
 */

export function aplicarOrdemDoDrag<T extends { ordem: number }>(
  leia: () => T[]
): T[] {
  /* Captura ANTES: a partir daqui, nenhuma leitura do computed entra. */
  const capturado = [...leia()];
  for (let i = 0; i < capturado.length; i++) {
    capturado[i].ordem = i + 1;
  }
  return capturado;
}
