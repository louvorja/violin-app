import { computed, nextTick, ref, type Ref } from "vue";

/**
 * ↑/↓ numa lista de resultados, como na busca rápida (Ctrl+K): as setas movem
 * o destaque sem tirar o cursor do campo e o Enter de quem consome age sobre o
 * item destacado. O mouse que se mexe por cima leva o destaque junto, para o
 * Enter nunca agir sobre outro item que não o marcado na tela.
 */
export function useListNavigation<T>(options: {
  items: () => readonly T[];
  /** Onde procurar o item destacado, para a seta trazê-lo até a vista. */
  container: Readonly<Ref<HTMLElement | null | undefined>>;
  activeSelector: string;
  /** Destaque ao (re)começar: 0 é o primeiro; -1, nenhum até a primeira seta. */
  start?: () => number;
}) {
  const start = () => options.start?.() ?? 0;
  const index = ref(start());
  const active = computed<T | null>(() => options.items()[index.value] ?? null);

  function reset(): void {
    index.value = start();
  }

  function move(delta: number): void {
    const last = options.items().length - 1;
    if (last < 0) return;
    index.value = Math.max(0, Math.min(last, index.value + delta));
    // Só a seta rola: o mouse já está em cima do item que destacou.
    void nextTick(reveal);
  }

  /** ↓/↑ andam pela lista; devolve `true` se a tecla era uma delas. */
  function handleArrow(event: KeyboardEvent): boolean {
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return false;
    event.preventDefault();
    move(delta);
    return true;
  }

  function reveal(): void {
    const item = options.container.value?.querySelector<HTMLElement>(options.activeSelector);
    if (!item) return;
    item.scrollIntoView?.({ block: "nearest" });
    // `nearest` não enxerga o cabeçalho fixo da tabela: subindo, a linha parava atrás dele.
    const head = item.closest("table")?.querySelector("thead th");
    if (!head) return;
    const hidden = head.getBoundingClientRect().bottom - item.getBoundingClientRect().top;
    const box = hidden > 0 ? scrollParent(item) : null;
    if (box) box.scrollTop -= hidden;
  }

  function setActive(i: number): void {
    if (i >= 0 && i < options.items().length) index.value = i;
  }

  return { index, active, move, handleArrow, setActive, reset };
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight)
      return node;
  }
  return null;
}
