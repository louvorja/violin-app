import { ref } from "vue";

/**
 * Blocos recolhidos permanecem assim durante a sessão do app, mesmo quando a
 * timeline é desmontada ao trocar de tela ou módulo. O estado é de sessão:
 * recarregar/fechar o app volta ao padrão expandido.
 */
const collapsedBlocos = ref<Set<string>>(new Set());

function toggleBlocoCollapse(blocoId: string): void {
  const next = new Set(collapsedBlocos.value);
  if (next.has(blocoId)) next.delete(blocoId);
  else next.add(blocoId);
  collapsedBlocos.value = next;
}

export function resetCollapsedBlocos(): void {
  collapsedBlocos.value = new Set();
}

export function useCollapsedBlocos() {
  return { collapsedBlocos, toggleBlocoCollapse };
}
