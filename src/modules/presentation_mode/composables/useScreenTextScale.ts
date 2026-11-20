import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

/**
 * Escala do texto das músicas por tela (%), por cima do tamanho configurado
 * nas Opções. Quem aplica é o `useSlideStyle`, em todas as janelas.
 */

export const TEXT_SCALE = Object.freeze({ MIN: 50, MAX: 200, STEP: 5, DEFAULT: 100 });

const KEY_OF = {
  main: KEYS.OPTIONS.SLIDE.MAIN_TEXT_SCALE,
  stage: KEYS.OPTIONS.SLIDE.RETURN_TEXT_SCALE,
} as const;

export function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) return TEXT_SCALE.DEFAULT;
  const stepped = Math.round(value / TEXT_SCALE.STEP) * TEXT_SCALE.STEP;
  return Math.min(TEXT_SCALE.MAX, Math.max(TEXT_SCALE.MIN, stepped));
}

export function useScreenTextScale() {
  return {
    get(screen: "main" | "stage"): number {
      return clampTextScale(Number($userdata.get<number>(KEY_OF[screen], TEXT_SCALE.DEFAULT)));
    },
    set(screen: "main" | "stage", value: number): void {
      $userdata.set(KEY_OF[screen], clampTextScale(value));
    },
  };
}
