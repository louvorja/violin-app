/**
 * De que lado o conteúdo novo entra, numa navegação que tem ordem.
 *
 * Uma troca de tela só parece navegação quando o movimento diz para onde se
 * foi. Abas lado a lado: ir para a da direita traz o conteúdo da direita. Itens
 * empilhados num menu lateral: ir para o de baixo traz o conteúdo de baixo. A
 * mesma entrada "de cima para baixo" em todo lugar não diz nada — é enfeite.
 *
 * Quem navega publica o resultado como `--lj-nav-x` (abas na horizontal) ou
 * `--lj-nav-y` (lista na vertical) no container dos painéis, e a classe
 * `lj-page-in` (ui.css) lê. Sem ordem conhecida as duas ficam em 0 e o painel
 * só esmaece.
 *
 * @category composable
 */
import { ref, watch, type Ref } from "vue";

export type NavDirection = -1 | 0 | 1;

/**
 * Lado da entrada ao sair de `previous` para `next`, dada a ordem dos itens:
 * `1` se `next` vem depois (direita, ou abaixo), `-1` se vem antes. Sem item
 * anterior, ou com algum dos dois fora da ordem, não há lado.
 */
export function pickNavDirection<T>(
  previous: T | null | undefined,
  next: T | null | undefined,
  order: readonly T[]
): NavDirection {
  if (previous == null || next == null || previous === next) return 0;
  const from = order.indexOf(previous);
  const to = order.indexOf(next);
  if (from < 0 || to < 0) return 0;
  return to > from ? 1 : -1;
}

/**
 * Direção da última troca de `current`, pela posição em `order`.
 *
 * `sync` de propósito: a direção precisa estar no CSS no mesmo quadro em que o
 * painel novo entra no DOM, ou a animação já começa do lado errado.
 */
export function useNavDirection<T>(
  current: () => T | null | undefined,
  order: () => readonly T[]
): Ref<NavDirection> {
  const direction = ref<NavDirection>(0);
  watch(
    current,
    (next, previous) => {
      direction.value = pickNavDirection(previous, next, order());
    },
    { flush: "sync" }
  );
  return direction;
}
