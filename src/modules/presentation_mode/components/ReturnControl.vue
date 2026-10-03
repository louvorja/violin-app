<template>
  <LjMenu :items="items" align="end">
    <template #trigger>
      <LjButton
        size="sm"
        class="pm-return-control"
        :class="{ 'pm-return-control--hidden': liveHidden }"
        :icon="ICONS.PROJECTION.RETURN"
        :title="tm('return_control.title')"
        data-testid="pm-return-control"
      >
        {{ label }}
      </LjButton>
    </template>
  </LjMenu>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjButton, LjMenu, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { LiveKind } from "../composables/useLiveContent";
import {
  RETURN_GROUPS,
  returnGroupOf,
  useReturnVisibility,
} from "../composables/useReturnVisibility";

/**
 * O que o retorno de palco mostra, ao alcance do operador: para o tipo no ar
 * (música, foto/vídeo, vídeo on-line, Bíblia), o mesmo conteúdo ou só o fundo.
 */

const props = defineProps<{ liveKind: LiveKind | null }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const visibility = useReturnVisibility();
const liveGroup = computed(() => returnGroupOf(props.liveKind));
const liveHidden = computed(() => !!liveGroup.value && visibility.isHidden(liveGroup.value));

const label = computed(() => {
  if (!liveGroup.value) return tm("return_control.short");
  return liveHidden.value ? tm("return_control.hidden") : tm("return_control.showing");
});

const items = computed<LjMenuItem[]>(() => [
  { label: tm("return_control.menu_title") },
  ...RETURN_GROUPS.map((group) => ({
    label: tm(`return_control.groups.${group}`),
    checked: !visibility.isHidden(group),
    action: () => visibility.setHidden(group, !visibility.isHidden(group)),
  })),
]);
</script>

<style scoped>
/* Retorno escondido: o aviso fica à vista, como o "Travar saída". */
.pm-return-control--hidden {
  color: var(--lj-danger);
}
</style>
