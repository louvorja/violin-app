import { ref } from "vue";

/**
 * A seleção da aba Vídeos online durante a execução do programa. O componente
 * é desmontado ao trocar de aba na biblioteca; sem este estado de módulo, ele
 * voltaria sempre para "Todos os vídeos" e pagaria o custo de montar a grade
 * inteira. A seleção começa vazia: a aba abre no convite para escolher uma
 * categoria ao lado.
 */

export type OnlineVideosSelection =
  | { kind: "none" }
  | { kind: "catalog-all" }
  | { kind: "catalog-channel"; channelId: string }
  | { kind: "catalog-playlist"; channelId: string; playlistId: string }
  | { kind: "custom-all" }
  | { kind: "custom"; categoryId: string };

const _selection = ref<OnlineVideosSelection>({ kind: "none" });
const _channelsOpen = ref(true);
const _myVideosOpen = ref(true);

export function useOnlineVideosSelection() {
  return {
    selection: _selection,
    channelsOpen: _channelsOpen,
    myVideosOpen: _myVideosOpen,
  };
}

/** Usado pelos testes e pelo início de uma nova apresentação. */
export function resetOnlineVideosSelection(): void {
  _selection.value = { kind: "none" };
  _channelsOpen.value = true;
  _myVideosOpen.value = true;
}
