/**
 * "Ao terminar" vindo de um item "Utilitário" da liturgia: grava a ação do
 * temporizador com um arquivo da Biblioteca de Mídia. "keep" (o padrão) não
 * mexe no que está no módulo; arquivo que sumiu da biblioteca também não.
 *
 * @category deve-virar-composable
 */
import $idb from "@/helpers/IndexedDB";
import $path from "@/helpers/Path";
import $userdata from "@/helpers/UserData";
import { DB_TABLE } from "@/constants/DbTables";
import { MediaEnum } from "@/enums/MediaEnum";
import type { TimerEndActionKeys } from "@/composables/useTimerEndAction";
import { launchString, type ModuleLaunchConfig } from "@/helpers/ModuleLaunch";

interface LibraryRecord {
  id: string;
  name?: string;
  type?: string;
  path?: string;
  data?: Blob | ArrayBuffer | ArrayBufferView;
  mime?: string;
}

/** URL tocável de um registro: o caminho do acervo, ou os bytes guardados nesta sessão. */
export async function resolveLibraryMedia(
  id: string
): Promise<{ url: string; name: string; type: string } | null> {
  const record = await $idb.get<LibraryRecord>(DB_TABLE.MEDIA_LIBRARY, id).catch(() => undefined);
  if (!record) return null;
  const path = String(record.path || "");
  let url = "";
  if (record.data && (!path || path.startsWith("blob:"))) {
    const data = record.data;
    const blob =
      data instanceof Blob ? data : new Blob([data as BlobPart], { type: record.mime || "" });
    if (blob.size) url = URL.createObjectURL(blob);
  } else {
    url = $path.media(path);
  }
  return url ? { url, name: record.name || id, type: record.type || "" } : null;
}

export async function applyLaunchEndAction(
  config: ModuleLaunchConfig,
  keys: Pick<TimerEndActionKeys, "END_ACTION" | "END_ACTION_AUDIO" | "END_ACTION_VIDEO">
): Promise<void> {
  const action = launchString(config, "end_action");
  if (!action || action === "keep") return;
  if (action === "none") {
    $userdata.set(keys.END_ACTION, MediaEnum.NONE);
    return;
  }
  const file = config.end_file as { libraryId?: string } | null | undefined;
  const media = file?.libraryId ? await resolveLibraryMedia(file.libraryId) : null;
  if (!media) return;
  if (action === "audio") {
    $userdata.set(keys.END_ACTION_AUDIO, { url: media.url, title: media.name });
    $userdata.set(keys.END_ACTION, MediaEnum.AUDIO);
  } else if (action === "video") {
    const type = media.type === "image" || media.type === "pdf" ? media.type : "video";
    $userdata.set(keys.END_ACTION_VIDEO, { url: media.url, type });
    $userdata.set(keys.END_ACTION, MediaEnum.VIDEO);
  }
}
