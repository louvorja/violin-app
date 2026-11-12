/**
 * Arquivos de liturgia que chegaram de fora da tela da Liturgia — duplo clique
 * num `.llja`, "Abrir com", arrastar para a janela. Quem recebe (a shell) só
 * enfileira e abre o módulo; a tela da Liturgia, quando monta ou já montada,
 * consome a fila e importa com o fluxo de sempre (perguntas, loader, avisos).
 *
 * Arquivo pequeno de propósito: a shell importa isto no boot sem arrastar o
 * código do módulo junto.
 */
import { shallowRef } from "vue";

export const pendingLiturgyFiles = shallowRef<File[]>([]);

export function requestLiturgyImport(file: File): void {
  pendingLiturgyFiles.value = [...pendingLiturgyFiles.value, file];
}

/**
 * Tira e devolve o próximo da fila. Fila vazia não é regravada: quem observa
 * `pendingLiturgyFiles` e chama isto a cada mudança entraria em laço, porque
 * um array novo (mesmo vazio) já conta como mudança.
 */
export function takeLiturgyImport(): File | undefined {
  const queue = pendingLiturgyFiles.value;
  if (!queue.length) return undefined;
  const [next, ...rest] = queue;
  pendingLiturgyFiles.value = rest;
  return next;
}
