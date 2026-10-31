import { onMounted, ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { zoomFromPayload, zoomStyle, type ProjectionZoom } from "@/helpers/ProjectionZoom";

/**
 * Lado das telas do zoom de imagem/PDF: guarda o último recorte anunciado e
 * dá o estilo do elemento da mídia. Ao montar, pede o recorte atual — uma
 * tela aberta (ou recarregada) no meio do zoom já entra recortada.
 */
export function useProjectionZoom() {
  const zoom = ref<ProjectionZoom | null>(null);
  useBroadcastListener(BROADCAST_TYPE.FILE_PROJECTION_ZOOM, (payload) => {
    zoom.value = zoomFromPayload(payload);
  });
  onMounted(() => Broadcast.send(BROADCAST_TYPE.REQUEST_FILE_PROJECTION_ZOOM, {}));
  return {
    zoom,
    styleFor: (key: string | null | undefined, page = 1) => zoomStyle(zoom.value, key, page),
  };
}
