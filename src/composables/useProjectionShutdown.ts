/**
 * Desliga, na janela principal, o estado que marca uma projeção como ligada
 * quando a janela dela some sozinha — ESC dentro da projeção, X da barra de
 * título, fechamento pelo sistema.
 *
 * Contraparte de `useProjectionCloseNotice`, que emite o aviso lá da projeção.
 * Registre uma vez, no Shell: as janelas de projeção não montam o Shell, então
 * só a janela principal reage.
 */
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useFileProjection } from "@/composables/useFileProjection";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { PROJECTION_TYPE } from "@/constants/Projection";
import { close as closeProjection, isOpen as isProjectionOpen } from "@/helpers/Projection";

/**
 * Recarregar a janela de projeção também dispara o aviso de fechamento. Esperar
 * e conferir o registro separa o fechamento de verdade do F5 — sem isso um
 * reload derrubaria a projeção no meio do culto.
 */
const CONFIRMACAO_MS = 400;

async function desligar(feature: string): Promise<void> {
  if (!feature) return;

  await new Promise((resolve) => setTimeout(resolve, CONFIRMACAO_MS));
  if (await isProjectionOpen(feature)) return;

  switch (feature) {
    case PROJECTION_TYPE.BACKGROUND:
      $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, false);
      localStorage.removeItem(KEYS.PROJECTION.LJ_BACKGROUND_PROJECTION);
      await closeProjection(PROJECTION_TYPE.BACKGROUND_RETURN);
      break;

    case PROJECTION_TYPE.BIBLE:
      $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, false);
      Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE, { text: "", reference: "", active: false });
      await closeProjection(PROJECTION_TYPE.BIBLE_RETURN);
      break;

    case PROJECTION_TYPE.FILE:
      $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING, false);
      localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
      Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, { action: "clear" });
      useFileProjection().stop();
      await closeProjection(PROJECTION_TYPE.FILE_RETURN);
      break;

    case PROJECTION_TYPE.ANNOUNCEMENTS:
      useFileProjection().stopProjection();
      break;

    // Música, operador, retornos e módulos genéricos (contador, timer, relógio)
    // não guardam estado próprio: o botão da ribbon lê a janela e se corrige.
  }
}

export function useProjectionShutdown(): void {
  useBroadcastListener(BROADCAST_TYPE.PROJECTION_CLOSED, (payload) => {
    const feature = (payload as { feature?: string } | null)?.feature;
    if (feature) void desligar(feature);
  });
}
