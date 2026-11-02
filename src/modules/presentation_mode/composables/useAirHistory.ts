import { computed, ref } from "vue";
import type { MusicMode } from "../program/musicModes";
import type { Playable } from "../program/playable";
import { recordEntry, type HistoryEntry } from "../program/history";
import { newId, todayIso } from "./useProgram";

/**
 * O que foi ao ar hoje, na ordem. Fica na memória do app: é o rascunho do
 * dia sem programa, e "Guardar o que passou como programa" é que o torna
 * documento. Virou o dia, recomeça.
 */

const _day = ref(todayIso());
const _entries = ref<HistoryEntry[]>([]);

function rollDay(now: Date): void {
  const day = todayIso(now);
  if (day === _day.value) return;
  _day.value = day;
  _entries.value = [];
}

export function useAirHistory() {
  return {
    entries: computed(() => _entries.value),
    record(
      playable: Playable,
      options: { mode?: MusicMode; muted?: boolean } = {},
      now = new Date()
    ): void {
      rollDay(now);
      _entries.value = recordEntry(_entries.value, {
        id: newId(),
        at: now.getTime(),
        playable,
        ...options,
      });
    },
    clear(): void {
      _entries.value = [];
    },
  };
}
