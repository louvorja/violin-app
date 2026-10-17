<template>
  <LjDialog
    :model-value="!!entry"
    :title="tm('file_actions.trash_title')"
    :icon="ICONS.ACTIONS.DELETE"
    size="sm"
    @update:model-value="(open: boolean) => !open && emit('cancel')"
  >
    <div v-if="entry" class="pm-trash" data-testid="pm-trash-dialog">
      <p class="pm-trash__text">
        <b>{{ entry.name }}</b>
        {{ tm("file_actions.trash_text") }}
      </p>
      <p v-if="shared" class="pm-trash__warn" data-testid="pm-trash-shared">
        <LjIcon :icon="ICONS.UI.ALERT" :size="14" class="pm-trash__warn-icon" />
        {{ church ? tm("file_actions.trash_church") : tm("file_actions.trash_synced") }}
      </p>
    </div>
    <template #footer>
      <LjButton @click="emit('cancel')">{{ t("actions.cancel") }}</LjButton>
      <LjButton
        variant="danger"
        :icon="ICONS.ACTIONS.DELETE"
        :loading="busy"
        data-testid="pm-trash-confirm"
        @click="emit('confirm')"
      >
        {{ tm("file_actions.trash") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjButton, LjDialog, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { LibraryEntry } from "../composables/useFileLibrary";
import { useChurchFolder } from "../composables/useChurchFolder";
import { isSyncedPath } from "../program/syncedPath";

/**
 * "Mover para a Lixeira?": sempre pergunta, diz que dá para recuperar e
 * avisa quando o arquivo está na pasta da igreja (ou noutra que sincroniza),
 * porque ele some também nos outros computadores.
 */

const props = defineProps<{ entry: LibraryEntry | null; busy?: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const churchFolder = useChurchFolder();

const church = computed(() => !!props.entry && churchFolder.isInside(props.entry.path));
const shared = computed(() => church.value || (!!props.entry && isSyncedPath(props.entry.path)));
</script>

<style scoped>
.pm-trash {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pm-trash__text {
  margin: 0;
  overflow-wrap: anywhere;
}

.pm-trash__warn {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--lj-danger-border);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-danger-soft);
  font-size: 11px;
}

.pm-trash__warn-icon {
  flex-shrink: 0;
  color: var(--lj-live-late-text);
}
</style>
