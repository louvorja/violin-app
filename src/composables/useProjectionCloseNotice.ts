/**
 * Avisa a janela principal quando esta janela de projeção some — por ESC, pelo
 * X da barra de título ou pelo sistema.
 *
 * O botão que liga a projeção mora na janela principal e guarda lá o estado de
 * "ligado" (UserData, refs de módulo). A janela de projeção fechava sozinha e
 * ninguém desligava esse estado: o ícone continuava vermelho com o projetor
 * apagado, e o operador precisava clicar duas vezes para voltar a projetar.
 *
 * Avisa duas vezes de propósito, e quem recebe confere se a janela sumiu mesmo:
 * o ESC avisa cedo, com a folga que as views deixam antes do `window.close()`,
 * porque uma mensagem postada dentro do `beforeunload` pode não sobreviver ao
 * teardown da janela.
 */
import { onMounted, onUnmounted } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

export function useProjectionCloseNotice(feature: string | (() => string)): void {
  function avisar(): void {
    const id = typeof feature === "function" ? feature() : feature;
    if (!id) return;
    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, { feature: id });
  }

  function aoTeclar(e: KeyboardEvent): void {
    if (e.key === "Escape") avisar();
  }

  onMounted(() => {
    window.addEventListener("keydown", aoTeclar);
    // Os dois eventos: o Chromium pula `beforeunload` em alguns fechamentos de
    // janela e `pagehide` em outros.
    window.addEventListener("beforeunload", avisar);
    window.addEventListener("pagehide", avisar);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", aoTeclar);
    window.removeEventListener("beforeunload", avisar);
    window.removeEventListener("pagehide", avisar);
  });
}
