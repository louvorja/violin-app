import { BROADCAST_TYPE, type BroadcastMessage } from "@/helpers/BroadcastTypes";

type StatefulBroadcast = {
  getLastPayload(_type: string, _moduleId?: string): unknown;
  send(_type: string, _payload?: unknown): void;
};

/**
 * Reemite estados de projeção que precisam sobreviver à abertura tardia de
 * uma janela. Mantê-lo puro/testável evita que um request fique acidentalmente
 * aninhado no ramo de outro tipo, como ocorreu com o estado de Libras.
 *
 * Retorna `true` quando reconheceu o request, mesmo que ainda não exista um
 * estado em cache. Assim o caller pode reservar handlers adicionais apenas
 * para requests que não pertencem a este contrato.
 */
export function handleProjectionStateRequest(
  message: Pick<BroadcastMessage, "type">,
  broadcast: StatefulBroadcast
): boolean {
  const responseByRequest: Readonly<Record<string, string>> = {
    [BROADCAST_TYPE.REQUEST_SLIDE_STATE]: BROADCAST_TYPE.SLIDE_CHANGE,
    [BROADCAST_TYPE.REQUEST_LIBRAS_STATE]: BROADCAST_TYPE.LIBRAS_TOGGLE,
  };

  const responseType = responseByRequest[message.type];
  if (!responseType) return false;

  const last = broadcast.getLastPayload(responseType);
  if (last != null) broadcast.send(responseType, last);
  return true;
}
