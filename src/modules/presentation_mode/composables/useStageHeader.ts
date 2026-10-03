import type { ComputedRef, Ref } from "vue";
import { computed } from "vue";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useSlides } from "@/composables/useSlides";
import type { ProgramItem } from "@/types/Presentation";
import type { PreviewView } from "../components/StagePreview.vue";
import { KIND_ICONS } from "../program/kinds";
import type { Playable } from "../program/playable";
import { useLiveContent, type LiveKind } from "./useLiveContent";
import { useStage } from "./useStage";

/**
 * O cabeçalho do palco: ícone, título e subtítulo do que está em prévia ou no
 * ar. Pasta e momento mostram o item e, ao lado, o arquivo que está na tela.
 */
export function useStageHeader(deps: {
  stagePreview: ComputedRef<boolean>;
  previewView: ComputedRef<PreviewView | null>;
  liveKind: Ref<LiveKind | null>;
  liveOrigin: ComputedRef<Playable | null>;
  liveProgramItem: ComputedRef<ProgramItem | null>;
  audioLive: ComputedRef<boolean>;
  audioTitle: ComputedRef<string>;
  findItem: (itemId: string) => ProgramItem | null;
}) {
  const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
  const stage = useStage();
  const slides = useSlides();
  const live = useLiveContent();

  const stageIcon = computed(() => {
    if (deps.stagePreview.value) return deps.previewView.value?.icon ?? null;
    if (!deps.liveKind.value) return null;
    return deps.liveProgramItem.value ? KIND_ICONS[deps.liveProgramItem.value.kind] : null;
  });

  /** O item do programa no ar; sem ele (biblioteca, outro módulo), o nome do que está na tela. */
  const stageTitle = computed(() => {
    if (deps.stagePreview.value) return deps.previewView.value?.title ?? "";
    const item = deps.liveProgramItem.value;
    if (item) {
      // Pasta e momento: o item e, ao lado, o arquivo que está na tela.
      const origin = deps.liveOrigin.value;
      const part =
        origin?.type === "folderFile"
          ? origin.entry.name
          : origin?.type === "child"
            ? item.children?.find((c) => c.id === origin.childId)?.title
            : null;
      return part ? `${item.title} · ${part}` : item.title;
    }
    if (deps.audioLive.value && !deps.liveKind.value) return deps.audioTitle.value;
    switch (deps.liveKind.value) {
      case "music":
        return slides.title.value;
      case "bible":
        return live.bible.value?.reference ?? "";
      case "file":
        return live.file.value?.title ?? "";
      case "online_video":
        return live.onlineTitle.value;
      case "announcements":
        return live.announcement.value?.nome ?? "";
      default:
        return tm("panels.stage");
    }
  });

  const stageMeta = computed(() => {
    const t = stage.preview.value;
    if (deps.stagePreview.value && t) {
      if (t.type === "program") return deps.findItem(t.itemId)?.subtitle ?? "";
      if (t.type === "song") return t.subtitle ?? "";
      if (t.type === "online") return t.channel ?? "";
      return "";
    }
    return deps.liveKind.value ? (deps.liveProgramItem.value?.subtitle ?? "") : "";
  });

  return { stageIcon, stageTitle, stageMeta };
}
