/**
 * Pilha de diálogos abertos, para que o diálogo que nasceu por último seja o
 * que pinta por cima.
 *
 * Não é vaidade. `LjDialog` ocupa DOIS níveis: o overlay vem de
 * `--lj-z-dialog` e o conteúdo, de `--lj-z-dialog + 1`. Com dois diálogos
 * abertos, os quatro empatam — e o desempate é a ordem dos nós no `<body>`,
 * que pode discordar da ordem de abertura. Aí a pintura (CSS) e o clique (a
 * camada `DismissableLayer` do Reka, que só deixa interativa a do topo)
 * respondem a mecanismos diferentes, e o resultado é o par que não deveria
 * existir: um diálogo na frente que não recebe clique, outro atrás que recebe.
 *
 * O nível é a posição na pilha, e não um contador que só cresce: quem fecha
 * volta para o nível de baixo e um diálogo encerrado não deixa buraco. Fechar
 * e reabrir o mesmo diálogo o põe de volta no topo, que é o correto — ele
 * voltou a ser o mais recente.
 */

const pilha: symbol[] = [];

/** Reserva um nível e devolve a profundidade correspondente. */
export function acquireDialogLevel(token: symbol): number {
  if (!pilha.includes(token)) pilha.push(token);
  return pilha.length - 1;
}

/** Devolve o nível. Devolver duas vezes não muda nada. */
export function releaseDialogLevel(token: symbol): void {
  const posicao = pilha.indexOf(token);
  if (posicao >= 0) pilha.splice(posicao, 1);
}

/** Só para teste: o estado é de módulo e cada caso parte de uma pilha limpa. */
export function resetDialogStack(): void {
  pilha.length = 0;
}