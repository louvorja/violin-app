/**
 * @category helper-puro — Camadas flutuantes e foco.
 */

/**
 * Um diálogo que terminou de abrir deve assumir o foco?
 *
 * O evento de autofocus pode chegar DEPOIS de outra camada já ter tomado o
 * foco — abrir o player e, em seguida, a paleta de comandos é o caso real.
 * Assumir nesse momento rouba o foco de quem está por cima, e o que o operador
 * digitar cai na camada de trás.
 *
 * A regra: assume quando o foco não está em camada nenhuma (o caso normal) ou
 * quando está dentro DESTE diálogo. Se estiver em outra camada — inclusive um
 * menu aberto por cima — não assume.
 */
export function deveAssumirFoco(ativo: Element | null, dialogo: Element | null): boolean {
  const camada = ativo?.closest?.("[data-dismissable-layer]") ?? null;
  if (!camada || !dialogo) return true;
  if (camada === dialogo) return true;
  /*
   * Outra camada tem o foco. Ela só "vence" se estiver DEPOIS deste diálogo no
   * documento: os portais são anexados ao body na ordem de abertura, então o
   * que vem depois é o que está por cima. Com isso, abrir uma janela nova sobre
   * uma antiga continua levando o foco; abrir uma camada SOBRE este diálogo
   * (a paleta) não é atropelado por um autofocus atrasado.
   *
   * Um menu DENTRO deste diálogo é descendente dele: não há `FOLLOWING`, então
   * o diálogo também não rouba o foco do próprio menu.
   */
  const dialogoEstaDepois = Boolean(
    camada.compareDocumentPosition(dialogo) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  return dialogoEstaDepois;
}
