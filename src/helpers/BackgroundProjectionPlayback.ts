/**
 * Ativa uma mídia da biblioteca Projeção de Fundo fora do módulo dela.
 *
 * É o caminho usado pela Liturgia: se a projeção já está no ar, troca a mídia
 * pela selecionada; se não está, abre as janelas e entra com a mídia. O estado
 * canônico continua sendo `UserData` + o payload de broadcast usado pelo
 * `BackgroundProjection.vue`.
 */
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { resolveBackgroundSoundPath } from "@/helpers/BackgroundSoundPath";
import {
  closeBackgroundProjectionWindows,
  openBackgroundProjectionWindows,
} from "@/helpers/ProjectionWindows";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { nextBackgroundEpoch } from "@/presentation/BackgroundPresentationState";

export interface BackgroundProjectionRecord {
  id: string;
  name?: string;
  path?: string | null;
  type?: string;
  data?: Blob | ArrayBuffer | Uint8Array | null;
  mime?: string | null;
}

/** URL reproduzível para a imagem/vídeo, recriando o blob se o path morreu. */
export function resolveBackgroundProjectionUrl(file: BackgroundProjectionRecord): string {
  return resolveBackgroundSoundPath({
    path: file.path,
    data: file.data,
    mime: file.mime,
  });
}

/**
 * Ativa a Projeção de Fundo com a mídia indicada.
 *
 * Se já estiver ativa, não reabre as janelas: só publica o novo item para a
 * pilha de camadas fazer a transição. Retorna `false` quando o registro não
 * tem bytes/caminho reproduzível.
 */
export async function activateBackgroundProjection(
  file: BackgroundProjectionRecord
): Promise<boolean> {
  const url = resolveBackgroundProjectionUrl(file);
  if (!url) return false;

  const type = file.type === "video" ? "video" : "image";
  const title = String(file.name || "");
  const payload = {
    active: true,
    epoch: nextBackgroundEpoch(),
    url,
    type,
    title,
    id: file.id,
  };

  const wasActive =
    $userdata.get<boolean>(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, false) === true;

  $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, true);
  try {
    localStorage.setItem(KEYS.PROJECTION.LJ_BACKGROUND_PROJECTION, JSON.stringify(payload));
  } catch {
    /* cache opcional; o broadcast leva o payload para as janelas abertas */
  }

  if (!wasActive) await openBackgroundProjectionWindows();
  $broadcast.send(BROADCAST_TYPE.BACKGROUND_PROJECTION, payload);
  return true;
}

/**
 * Encerra a Projeção de Fundo: desliga o estado, limpa o cache e fecha as
 * janelas. É o "Encerrar projeção" da biblioteca e o "Parar" do módulo.
 */
export async function stopBackgroundProjection(): Promise<void> {
  $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, false);
  try {
    localStorage.removeItem(KEYS.PROJECTION.LJ_BACKGROUND_PROJECTION);
  } catch {
    /* cache opcional */
  }
  $broadcast.send(BROADCAST_TYPE.BACKGROUND_PROJECTION, {
    active: false,
    epoch: nextBackgroundEpoch(),
  });
  $broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE, {});
  await closeBackgroundProjectionWindows();
}

/**
 * Limpa a mídia da Projeção de Fundo, mantendo as janelas abertas — o mesmo
 * "Limpar" da ribbon do módulo.
 */
export function clearBackgroundProjection(): void {
  try {
    localStorage.removeItem(KEYS.PROJECTION.LJ_BACKGROUND_PROJECTION);
  } catch {
    /* cache opcional */
  }
  $broadcast.send(BROADCAST_TYPE.BACKGROUND_PROJECTION, {
    active: false,
    epoch: nextBackgroundEpoch(),
  });
}
