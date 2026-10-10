import { computed, onScopeDispose, readonly, ref, shallowRef } from "vue";
import {
  applyPwaUpdate,
  checkPwaUpdate,
  subscribePwaUpdates,
  type PwaUpdateState,
} from "@/helpers/PwaUpdates";
import AppData from "@/helpers/AppData";
import UserData from "@/helpers/UserData";
import ScheduledStore from "@/helpers/ScheduledStore";
import { hasOpenWebWindows } from "@/helpers/projection/webWindow";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import { useBackgroundSound } from "@/composables/useBackgroundSound";
import { useAppStore } from "@/stores/appStore";
import { KEYS } from "@/constants/UserDataKeys";
import { ModuleEnum } from "@/enums/ModuleEnum";

export function usePwaUpdates() {
  const state = shallowRef<PwaUpdateState>({ status: "idle", ready: false, lastCheckedAt: null });
  const unsubscribe = subscribePwaUpdates((value) => {
    state.value = value;
  });
  const tasks = useBackgroundTasks();
  const backgroundSound = useBackgroundSound();
  const store = useAppStore();
  // Window.closed não é reativo; o clique também revalida o estado real.
  const pulse = ref(0);
  const timer = setInterval(() => {
    pulse.value++;
  }, 1000);
  const hasWork = () =>
    hasOpenWebWindows() ||
    tasks.hasActiveTasks.value ||
    backgroundSound.isPlaying.value ||
    Boolean(AppData.get(KEYS.MODULES.MEDIA.IS_PLAYING, false)) ||
    Boolean((store.modules[ModuleEnum.SLIDE_EDITOR] as { show?: boolean } | undefined)?.show);
  const blocked = computed(() => {
    void pulse.value;
    return hasWork();
  });
  onScopeDispose(() => {
    unsubscribe();
    clearInterval(timer);
  });
  return {
    state: readonly(state),
    blocked,
    check: checkPwaUpdate,
    apply: () =>
      applyPwaUpdate({
        canReload: () => !hasWork(),
        beforeReload: async () => {
          await ScheduledStore.flush();
          UserData.flushPendingWebSave();
        },
      }),
  };
}
