/**
 * useLibrasState — estado de ativação do Libras, compartilhado por todas as janelas.
 *
 * O estado mora no localStorage (persistência) e viaja por LIBRAS_TOGGLE
 * (sincronia entre janelas). Antes cada tela lia o localStorage por conta
 * própria: como leitura de localStorage não é reativa e só o interruptor
 * geral emitia broadcast, desligar a tradução não parava as chamadas à API
 * do VLibras nas janelas já abertas.
 *
 * @category composable
 */

import { ref, type Ref } from "vue";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS_LS } from "@/constants/LocalStorageKeys";

type LibrasScope = "music" | "bible";

interface LibrasFlags {
  enabled?: boolean;
  musics?: boolean;
  bible?: boolean;
  obs?: boolean;
}

function read(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : raw === "true";
}

const enabled = ref(read(KEYS_LS.LIBRAS.ENABLED, false));
const musicsEnabled = ref(read(KEYS_LS.LIBRAS.MUSICS_ENABLED, true));
const bibleEnabled = ref(read(KEYS_LS.LIBRAS.BIBLE_ENABLED, true));
const showOnObs = ref(read(KEYS_LS.LIBRAS.SHOW_ON_OBS, false));

$broadcast.listen((msg) => {
  if (msg.type !== BROADCAST_TYPE.LIBRAS_TOGGLE) return;
  const flags = (msg.payload || {}) as LibrasFlags;
  if (typeof flags.enabled === "boolean") enabled.value = flags.enabled;
  if (typeof flags.musics === "boolean") musicsEnabled.value = flags.musics;
  if (typeof flags.bible === "boolean") bibleEnabled.value = flags.bible;
  if (typeof flags.obs === "boolean") showOnObs.value = flags.obs;
});

function setFlag(key: string, target: Ref<boolean>, value: boolean): void {
  target.value = value;
  localStorage.setItem(key, String(value));
  $broadcast.send(BROADCAST_TYPE.LIBRAS_TOGGLE, {
    enabled: enabled.value,
    musics: musicsEnabled.value,
    bible: bibleEnabled.value,
    obs: showOnObs.value,
  });
}

/** Traduz este tipo de conteúdo? Reativo — use dentro de computed/watch. */
function scopeEnabled(scope: LibrasScope): boolean {
  if (!enabled.value) return false;
  return scope === "bible" ? bibleEnabled.value : musicsEnabled.value;
}

export function useLibrasState() {
  return {
    enabled,
    musicsEnabled,
    bibleEnabled,
    showOnObs,
    scopeEnabled,
    setEnabled: (value: boolean) => setFlag(KEYS_LS.LIBRAS.ENABLED, enabled, value),
    setMusicsEnabled: (value: boolean) =>
      setFlag(KEYS_LS.LIBRAS.MUSICS_ENABLED, musicsEnabled, value),
    setBibleEnabled: (value: boolean) => setFlag(KEYS_LS.LIBRAS.BIBLE_ENABLED, bibleEnabled, value),
    setShowOnObs: (value: boolean) => setFlag(KEYS_LS.LIBRAS.SHOW_ON_OBS, showOnObs, value),
  };
}
