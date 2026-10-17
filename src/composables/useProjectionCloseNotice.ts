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
  const idAtual = (): string => (typeof feature === "function" ? feature() : feature);

  /**
   * `definitivo` só no ESC: ali a janela vai mesmo fechar. `beforeunload` e
   * `pagehide` também disparam num F5, e quem recebe precisa esperar a janela
   * dizer se voltou.
   */
  function avisar(definitivo: boolean): void {
    const id = idAtual();
    if (!id) return;
    Broadcast.send(BROADCAST_TYPE.PROJECTION_CLOSED, {
      feature: id,
      ...(definitivo ? { definitive: true } : {}),
    });
  }

  const aoDescarregar = (): void => avisar(false);

  function aoTeclar(e: KeyboardEvent): void {
    if (e.key === "Escape") avisar(true);
  }

  onMounted(() => {
    window.addEventListener("keydown", aoTeclar);
    // Os dois eventos: o Chromium pula `beforeunload` em alguns fechamentos de
    // janela e `pagehide` em outros.
    window.addEventListener("beforeunload", aoDescarregar);
    window.addEventListener("pagehide", aoDescarregar);
    // O contrário do aviso de fechamento: uma janela que recarregou volta
    // dizendo que voltou, e a principal não apaga o que ela vai reler.
    const id = idAtual();
    if (id) Broadcast.send(BROADCAST_TYPE.PROJECTION_OPENED, { feature: id });
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", aoTeclar);
    window.removeEventListener("beforeunload", aoDescarregar);
    window.removeEventListener("pagehide", aoDescarregar);
  });
}
