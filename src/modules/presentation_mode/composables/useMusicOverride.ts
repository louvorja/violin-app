import { computed } from "vue";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { isMusicOverride, type MusicOverride } from "../program/musicModes";

/**
 * Versão de todas as músicas, escolhida no topo do módulo. Fica guardada: a
 * banda que veio hoje costuma vir no próximo culto também.
 */

export function currentMusicOverride(): MusicOverride {
  const value = $userdata.get<string>(KEYS.MODULES.PRESENTATION_MODE.MUSIC_MODE_OVERRIDE, "");
  return isMusicOverride(value) ? value : "";
}

export function useMusicOverride() {
  return {
    override: computed<MusicOverride>(() => currentMusicOverride()),
    setOverride(value: MusicOverride): void {
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.MUSIC_MODE_OVERRIDE, value);
    },
  };
}
