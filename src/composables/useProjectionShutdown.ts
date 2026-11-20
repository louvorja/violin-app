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
import { nextBackgroundEpoch } from "@/presentation/BackgroundPresentationState";

/**
 * Recarregar a janela de projeção também dispara o aviso de fechamento. Esperar
 * e conferir o registro separa o fechamento de verdade do F5 — sem isso um
 * reload derrubaria a projeção no meio do culto.
 */
const CONFIRMACAO_MS = 400;

/**
 * Janelas fechadas de propósito por quem segue no controle do conteúdo — o
 * Modo apresentação desligando só a tela principal: o retorno continua com o
 * mesmo vídeo, então nada do estado pode ser desfeito por esse fechamento.
 */
const _closingOnPurpose = new Map<string, number>();
/** A janela avisa mais de uma vez ao fechar (ESC, beforeunload, pagehide): a marca vale por um tempo. */
const ON_PURPOSE_MS = 5000;

export function closingOnPurpose(feature: string): void {
  _closingOnPurpose.set(feature, Date.now() + ON_PURPOSE_MS);
}

/**
 * O registro de janelas só conhece as que o app abriu. Uma projeção aberta por
 * fora (outro navegador, fonte do OBS) some do registro enquanto recarrega, e
 * numa máquina lenta a página volta depois da conferência acima: o estado era
 * apagado e a janela recarregada subia vazia. Quem recarrega avisa que voltou
 * (`PROJECTION_OPENED`); esperamos esse aviso antes de desistir dela. O ESC não
 * espera — ali a janela fecha de verdade.
 */
const REABERTURA_MS = 1500;

async function desligar(
  feature: string,
  definitivo: boolean,
  reabertaEm: Map<string, number>
): Promise<void> {
  if (!feature) return;
  if ((_closingOnPurpose.get(feature) ?? 0) > Date.now()) return;

  const avisadoEm = Date.now();
  const voltou = (): boolean => (reabertaEm.get(feature) ?? 0) >= avisadoEm;

  await new Promise((resolve) => setTimeout(resolve, CONFIRMACAO_MS));
  if (await isProjectionOpen(feature)) return;
  if (!definitivo) {
    await new Promise((resolve) => setTimeout(resolve, REABERTURA_MS));
    if (await isProjectionOpen(feature)) return;
  }
  if (voltou()) return;

  switch (feature) {
    case PROJECTION_TYPE.BACKGROUND:
      $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, false);
      localStorage.removeItem(KEYS.PROJECTION.LJ_BACKGROUND_PROJECTION);
      Broadcast.send(BROADCAST_TYPE.BACKGROUND_PROJECTION, {
        active: false,
        epoch: nextBackgroundEpoch(),
      });
      await closeProjection(PROJECTION_TYPE.BACKGROUND_RETURN);
      break;

    case PROJECTION_TYPE.BIBLE:
      $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, false);
      Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE_INTENT, { text: "", reference: "", active: false });
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
        $appdata.get<boolean>(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, false) === true ||
        // O player embutido do YouTube segue na janela principal, que assume som e relógio.
        $appdata.get<boolean>(KEYS.MODULES.MEDIA.CONFIG.IS_YOUTUBE, false) === true;
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
  const reabertaEm = new Map<string, number>();
  useBroadcastListener(BROADCAST_TYPE.PROJECTION_OPENED, (payload) => {
    const feature = (payload as { feature?: string } | null)?.feature;
    if (feature) reabertaEm.set(feature, Date.now());
  });
  useBroadcastListener(BROADCAST_TYPE.PROJECTION_CLOSED, (payload) => {
    const data = payload as { feature?: string; definitive?: boolean } | null;
    if (data?.feature) void desligar(data.feature, data.definitive === true, reabertaEm);
  });
}
