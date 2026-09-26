/**
 * Composable que conecta um módulo à view genérica `/projection/module`.
 *
 * Cada módulo:
 *   - chama emit({ text, reference, active }) sempre que seu valor visível muda
 *   - opcionalmente registra `onAction` para responder à ribbon contextual
 *
 * O composable cuida de:
 *   - publicar pedidos de estado para a autoridade da janela principal
 *   - escutar MODULE_RIBBON_ACTION e despachar para o handler local
 *
 * Exemplo de uso (counter):
 *   const projection = useModuleProjection("counter", {
 *     onAction(action) {
 *       if (action === "increment") count.value++;
 *       if (action === "reset") count.value = 0;
 *     },
 *   });
 *   watch(count, (n) => projection.emit({ text: String(n), active: true }));
 */

import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";

interface ProjectionPayload {
  text?: string;
  /**
   * Padrão: string (ex: clock usa a data; bible a referência bíblica).
   * Módulos podem enviar outros tipos (ex: draw envia `string[]` de
   * sorteados para a projeção montar chips).
   */
  reference?: string | string[];
  active?: boolean;
  /** Cor de destaque do texto (ex: alerta do timer/timer_worship). */
  color?: string;
}

interface UseModuleProjectionOptions {
  /** Handler para BIBLE_RIBBON_ACTION/MODULE_RIBBON_ACTION quando o módulo está ativo. */
  onAction?: (action: string, payload?: unknown) => void;
  /** Returna true se o módulo está visível/ativo agora (controla quem responde). */
  isVisible?: () => boolean;
}

export function useModuleProjection(moduleId: string, opts: UseModuleProjectionOptions = {}) {
  function emit(payload: ProjectionPayload) {
    Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_INTENT, {
      module: moduleId,
      ...payload,
    });
  }

  // Recebe ações da ribbon contextual.
  useBroadcastListener(BROADCAST_TYPE.MODULE_RIBBON_ACTION, (payload) => {
    const data = payload as { module?: string; action?: string; payload?: unknown };
    if (data?.module !== moduleId) return;
    if (opts.isVisible && !opts.isVisible()) return;
    if (data.action && opts.onAction) opts.onAction(data.action, data.payload);
  });

  return { emit };
}
