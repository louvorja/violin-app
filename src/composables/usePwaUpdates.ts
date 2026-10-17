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
  let recoveryPending = false;
  let recovering = false;
  let disposed = false;
  let nextRecoveryAt = 0;
  // Window.closed não é reativo; o clique também revalida o estado real.
  const pulse = ref(0);
  const timer = setInterval(() => {
    pulse.value++;
    void recoverWhenSafe();
  }, 1000);
  const hasWork = () =>
    Boolean(
      document.activeElement?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')
    ) ||
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
    disposed = true;
    unsubscribe();
    clearInterval(timer);
  });
  const apply = () =>
    applyPwaUpdate({
      canReload: () => !disposed && !hasWork(),
      beforeReload: async () => {
        await ScheduledStore.flush();
        UserData.flushPendingWebSave();
      },
    });
  const recoverWhenSafe = async () => {
    if (
      disposed ||
      recovering ||
      !recoveryPending ||
      !state.value.ready ||
      document.visibilityState === "hidden" ||
      hasWork() ||
      Date.now() < nextRecoveryAt
    )
      return;
    recovering = true;
    try {
      recoveryPending = !(await apply());
      // Uma gravação indisponível não pode causar uma tentativa a cada segundo.
      if (recoveryPending) nextRecoveryAt = Date.now() + 60_000;
    } finally {
      recovering = false;
    }
  };
  const checkAndApply = async () => {
    recoveryPending = true;
    nextRecoveryAt = 0;
    await checkPwaUpdate();
    await recoverWhenSafe();
  };
  let wasHidden = document.visibilityState === "hidden";
  const resumed = () => {
    if (document.visibilityState === "hidden") wasHidden = true;
    else if (wasHidden) {
      wasHidden = false;
      void checkAndApply();
    }
  };
  const recover = () => {
    void checkAndApply();
  };
  document.addEventListener("visibilitychange", resumed);
  window.addEventListener("lj:pwa-recover", recover);
  onScopeDispose(() => {
    document.removeEventListener("visibilitychange", resumed);
    window.removeEventListener("lj:pwa-recover", recover);
  });
  return {
    state: readonly(state),
    blocked,
    check: checkAndApply,
    apply,
  };
}
