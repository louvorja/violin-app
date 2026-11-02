import { computed, ref } from "vue";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

export const LIBRARY_DEFAULT_HEIGHT = 244;
const LIBRARY_TALL_HEIGHT = 340;

/** Largura e altura da biblioteca, gravadas nas preferências. */
export function useLibraryLayout() {
  const fullWidth = computed(
    () => $userdata.get<boolean>(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FULL_WIDTH, false) === true
  );

  /** Durante o arraste a altura é local; só vai para as preferências ao soltar. */
  const dragging = ref<number | null>(null);
  const height = computed(
    () =>
      dragging.value ??
      $userdata.get<number>(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_HEIGHT, LIBRARY_DEFAULT_HEIGHT) ??
      LIBRARY_DEFAULT_HEIGHT
  );

  function saveHeight(value: number): void {
    $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_HEIGHT, Math.round(value));
    dragging.value = null;
  }

  return {
    fullWidth,
    height,
    tall: computed(() => height.value > LIBRARY_DEFAULT_HEIGHT),
    drag(value: number): void {
      dragging.value = value;
    },
    saveHeight,
    toggleWidth(): void {
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FULL_WIDTH, !fullWidth.value);
    },
    toggleHeight(): void {
      saveHeight(height.value > LIBRARY_DEFAULT_HEIGHT ? LIBRARY_DEFAULT_HEIGHT : LIBRARY_TALL_HEIGHT);
    },
  };
}
