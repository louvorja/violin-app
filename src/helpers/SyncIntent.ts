/**
 * SyncIntent.ts — Pedido de "baixar este álbum" vindo de outras telas.
 *
 * O download é centralizado em Opções → Sincronizar (desktop e PWA). Quem quer
 * oferecer o atalho (diálogo do álbum) só registra o álbum aqui e pede para o
 * menu abrir na tela de Sincronizar, que o deixa marcado.
 */
import { ref } from "vue";

export const pendingSyncAlbum = ref<number | null>(null);

export function requestAlbumDownload(albumId: number | string): void {
  const id = Number(albumId);
  if (!Number.isInteger(id) || id <= 0) return;
  pendingSyncAlbum.value = id;
  window.dispatchEvent(new CustomEvent("louvorja:open-sync"));
}
