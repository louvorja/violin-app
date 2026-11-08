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

/** Tira e devolve o próximo da fila. */
export function takeLiturgyImport(): File | undefined {
  const [next, ...rest] = pendingLiturgyFiles.value;
  pendingLiturgyFiles.value = rest;
  return next;
}
