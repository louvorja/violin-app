import { ref, watch, type Ref, type WatchSource } from "vue";
import Media from "@/composables/useMedia";

interface PlaylistSongLike {
  onlineVideo?: { itemKey?: string } | null;
}

export interface OnlineVideoStage {
  /** Item desta tela que está no telão; vazio quando não há. */
  projectingId: Readonly<Ref<string>>;
  /** Marca o item e o abre; `false` quando o operador cancelou ou o vídeo não toca. */
  project: (_id: string, _open: () => Promise<boolean>) => Promise<boolean>;
  stop: () => void;
}

/**
 * Qual item da tela está no telão.
 *
 * O palco muda sem passar pela tela que o ocupou: o operador fecha pelo player,
 * o vídeo termina, outro módulo projeta por cima. Guardar só os cliques daqui
 * deixava o "Parar Projeção" à vista sem nada projetado — e ele parava a mídia
 * de outro módulo.
 */
export function useOnlineVideoStage(
  currentSong: WatchSource<PlaylistSongLike | null | undefined>
): OnlineVideoStage {
  const projectingId = ref("");
  // Época do palco que o item avulso ocupa; null enquanto ele abre ou quando a playlist conduz.
  let ownedEpoch: number | null = null;
  let playlistDriven = false;

  function release(): void {
    ownedEpoch = null;
    playlistDriven = false;
    projectingId.value = "";
  }

  async function project(id: string, open: () => Promise<boolean>): Promise<boolean> {
    projectingId.value = id;
    ownedEpoch = null;
    playlistDriven = false;
    const opened = await open();
    // Outro pedido já assumiu o destaque: este não mexe mais nele.
    if (projectingId.value !== id || playlistDriven) return opened;
    if (opened) ownedEpoch = Media.stageEpoch();
    else release();
    return opened;
  }

  function stop(): void {
    release();
    Media.close(true);
  }

  watch(
    () => Media.stageEpoch(),
    (epoch) => {
      if (ownedEpoch !== null && epoch !== ownedEpoch) release();
    }
  );

  watch(currentSong, (song) => {
    const key = song?.onlineVideo?.itemKey;
    if (key) {
      ownedEpoch = null;
      playlistDriven = true;
      projectingId.value = key;
    } else if (!song && playlistDriven) {
      release();
    }
  });

  return { projectingId, project, stop };
}
