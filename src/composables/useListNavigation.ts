import { computed, nextTick, ref, type Ref } from "vue";

/**
 * ↑/↓ numa lista de resultados, como na busca rápida (Ctrl+K): as setas movem
 * o destaque sem tirar o cursor do campo e o Enter de quem consome age sobre o
 * item destacado. O mouse que se mexe por cima leva o destaque junto, para o
 * Enter nunca agir sobre outro item que não o marcado na tela.
 */
export function useListNavigation<T>(options: {
  items: () => readonly T[];
  /** O contêiner que rola a lista, para a seta trazer o destacado até a vista. */
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

  function reveal(): void {
    const box = options.container.value;
    const item = box?.querySelector<HTMLElement>(options.activeSelector);
    if (!box || !item) return;
    item.scrollIntoView?.({ block: "nearest" });
    // `nearest` não enxerga o cabeçalho fixo da tabela: subindo, a linha parava atrás dele.
    const head = box.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const hidden =
      box.getBoundingClientRect().top + box.clientTop + head - item.getBoundingClientRect().top;
    if (hidden > 0) box.scrollTop -= hidden;
  }

  function setActive(i: number): void {
    if (i >= 0 && i < options.items().length) index.value = i;
  }

  return { index, active, move, setActive, reset };
}
