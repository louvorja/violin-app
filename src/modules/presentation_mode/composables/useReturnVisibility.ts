import { computed, watch, type Ref } from "vue";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import type { LiveKind } from "./useLiveContent";
import { setReturnBlank } from "./useOutputs";

/**
 * O que o retorno de palco mostra, por tipo de conteúdo: o mesmo que está no
 * ar, ou só o fundo. A escolha vale para todos do mesmo tipo e fica guardada —
 * quem esconde o vídeo do palco num culto costuma esconder no seguinte.
 */

export const RETURN_GROUPS = ["music", "file", "online_video", "bible"] as const;
export type ReturnGroup = (typeof RETURN_GROUPS)[number];

/** Anúncios seguem as fotos e vídeos: são imagens projetadas. */
export function returnGroupOf(kind: LiveKind | null): ReturnGroup | null {
  if (kind === "announcements") return "file";
  return kind && (RETURN_GROUPS as readonly string[]).includes(kind) ? (kind as ReturnGroup) : null;
}

const hidden = computed(
  () => $userdata.get<Partial<Record<ReturnGroup, boolean>>>(KEYS.MODULES.PRESENTATION_MODE.RETURN_HIDDEN, {}) ?? {}
);

function isHidden(group: ReturnGroup): boolean {
  return hidden.value[group] === true;
}

function setHidden(group: ReturnGroup, value: boolean): void {
  $userdata.set(KEYS.MODULES.PRESENTATION_MODE.RETURN_HIDDEN, { ...hidden.value, [group]: value });
}

export function useReturnVisibility() {
  return { isHidden, setHidden };
}

/**
 * O retorno acompanha o que está no ar: o tipo escondido vira fundo. Fica no
 * Index (sempre montado), não no botão — que pode sumir da tela.
 */
export function useReturnBlankSync(liveKind: Ref<LiveKind | null>): void {
  watch(
    () => {
      const group = returnGroupOf(liveKind.value);
      return !!group && isHidden(group);
    },
    (blank) => setReturnBlank(blank),
    { immediate: true }
  );
}
