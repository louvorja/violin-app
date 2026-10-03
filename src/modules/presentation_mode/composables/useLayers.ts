import { computed } from "vue";
import $appdata from "@/helpers/AppData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import { KEYS } from "@/constants/UserDataKeys";
import Media from "@/composables/useMedia";
import { useFileProjection } from "@/composables/useFileProjection";
import { i18nAtual } from "@/i18n";
import { takeOffAir } from "./takeOffAir";
import { useLiveContent } from "./useLiveContent";
import { anyScreenOpen, returnOverride, showOnReturn } from "./useOutputs";
import { useReturnPlayer } from "./useReturnPlayer";

/**
 * As camadas do que está tocando, como no FreeShow — por enquanto três:
 *
 * - tela: o conteúdo da tela principal (música, versículo, foto, vídeo, PDF,
 *   anúncios). Um substitui o outro.
 * - retorno: o que está só no retorno de palco (foto ou vídeo).
 * - áudio: o som que sai do computador — o "só áudio" ou o do vídeo no ar.
 *
 * Regra que não pode falhar: um vídeo por vez. Abrir um vídeo encerra o outro,
 * esteja ele na tela principal ou só no retorno — senão os dois tocam, e o
 * operador perde o controle de um deles. Fundo, sobreposição e timer entram
 * depois como camadas novas, sem mexer nesta regra.
 */

export type LayerId = "screen" | "return" | "audio";

export interface Layer {
  id: LayerId;
  /** O que está na camada; vazio quando ela está livre. */
  title: string;
  /** Tira o que está nesta camada (e só nela). */
  stop: () => void;
}

function tm(key: string): string {
  const t = i18nAtual()?.global?.t as ((k: string) => unknown) | undefined;
  const full = `modules.presentation_mode.layers.${key}`;
  return t ? String(t(full)) : full;
}

/** O vídeo da tela principal (arquivo ou on-line), tocando no player do operador. */
function screenVideoPlaying(): boolean {
  const live = useLiveContent();
  const kind = live.current.value;
  return kind === "online_video" || (kind === "file" && live.file.value?.type === "video");
}

/**
 * Antes de um vídeo entrar numa camada: o vídeo da outra camada sai. Chamado
 * pelo módulo ao mandar um vídeo à tela principal e ao levar um só ao retorno.
 */
export function claimVideo(target: "screen" | "return"): void {
  if (target === "screen" && useReturnPlayer().state.id) {
    void showOnReturn(null);
    Telemetry.track("presentation_layer_video_replaced", { from: "return" });
  }
  if (target === "return" && screenVideoPlaying()) {
    takeOffAir(useLiveContent().current.value);
    Telemetry.track("presentation_layer_video_replaced", { from: "screen" });
  }
}

/** Tira tudo de todas as camadas: as telas ficam no fundo. */
export function stopAllLayers(): void {
  const live = useLiveContent();
  if (live.current.value) takeOffAir(live.current.value);
  if (returnOverride.value) void showOnReturn(null);
  if ($appdata.get<boolean>(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, false)) Media.close(true, false, true);
}

let _orphansChecked = false;

/**
 * O app recarregou (ou abriu) com telas de projeção ainda mostrando algo que
 * ninguém controla — o player que tocava sumiu com a janela principal. Uma
 * vez por janela: com telas abertas e nada conhecido no ar, as telas voltam
 * ao fundo, e o operador é avisado.
 */
export async function resetOrphanScreens(): Promise<void> {
  if (_orphansChecked) return;
  _orphansChecked = true;
  if (!(await anyScreenOpen())) return;
  if (useLiveContent().current.value || useReturnPlayer().state.id) return;
  Media.close(true, false, true);
  Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, { action: "clear" });
  Broadcast.send(BROADCAST_TYPE.RETURN_OVERRIDE, { active: false });
  Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE_INTENT, { text: "", reference: "", active: false });
  useFileProjection().stopProjection();
  $snackbar.warning(tm("orphans_cleared"), { timeout: 8000 });
  Telemetry.track("presentation_orphan_screens_cleared", {});
}

/** As camadas como o painel "No ar agora" mostra. */
export function useLayers() {
  const live = useLiveContent();
  const player = useReturnPlayer();

  const screenTitle = computed(() => {
    switch (live.current.value) {
      case "music":
        return live.music.title.value;
      case "bible":
        return live.bible.value?.reference ?? "";
      case "file":
        return live.file.value?.title ?? "";
      case "online_video":
        return live.onlineTitle.value;
      case "announcements":
        return live.announcement.value?.nome ?? tm("announcements");
      default:
        return "";
    }
  });

  const audioTitle = computed(() => {
    if ($appdata.get<boolean>(KEYS.MODULES.MEDIA.CONFIG.AUDIO_ONLY, false)) {
      return $appdata.get<string>(KEYS.MODULES.MEDIA.CONFIG.TITLE, "") ?? "";
    }
    // O som do vídeo no ar sai pelo mesmo player: ocupa a camada de áudio.
    if (screenVideoPlaying()) return screenTitle.value;
    if (player.state.id) return player.state.title;
    return "";
  });

  const layers = computed<Layer[]>(() => [
    { id: "screen", title: screenTitle.value, stop: () => takeOffAir(live.current.value) },
    { id: "return", title: returnOverride.value?.title ?? "", stop: () => void showOnReturn(null) },
    {
      id: "audio",
      title: audioTitle.value,
      stop: () => (player.state.id && !screenVideoPlaying() ? void showOnReturn(null) : Media.close(true, false, true)),
    },
  ]);

  return { layers, busy: computed(() => layers.value.some((l) => !!l.title)), stopAll: stopAllLayers };
}
