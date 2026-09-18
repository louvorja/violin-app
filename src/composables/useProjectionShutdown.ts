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
import $appdata from "@/helpers/AppData";
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

    case PROJECTION_TYPE.FILE: {
      // Fechar só a janela de projeção não é parar o vídeo. O player continua
      // ativo na janela principal e precisa conseguir reabrir a projeção com
      // o mesmo payload (em especial depois de o operador fechar/reabrir a
      // tela durante o culto). O estado persistido só é invalidado pelo
      // caminho explícito de MEDIA_CLOSE.
      const mediaPlaying =
        $appdata.get<boolean>(KEYS.MODULES.MEDIA.IS_PLAYING, false) === true ||
        $appdata.get<boolean>(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, false) === true;
      // O botão do acervo deve voltar a permitir "projetar" o mesmo item,
      // mesmo que o player interno continue tocando sem a janela.
      $userdata.set(KEYS.MODULES.MEDIA_LIBRARY.IS_PLAYING, false);
      if (!mediaPlaying) {
        localStorage.removeItem(KEYS.PROJECTION.LJ_FILE_PROJECTION);
        Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, { action: "clear" });
        useFileProjection().stop();
      } else {
        console.info("[ProjectionShutdown] projeção de arquivo fechada; vídeo continua ativo");
      }
      await closeProjection(PROJECTION_TYPE.FILE_RETURN);
      break;
    }

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
