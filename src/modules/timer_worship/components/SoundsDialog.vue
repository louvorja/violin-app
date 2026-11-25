<template>
  <LjDialog
    :model-value="modelValue"
    :title="tm('sounds.title')"
    :icon="ICONS.MEDIA.AUDIO"
    size="md"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="tws-intro">{{ tm("sounds.intro") }}</p>
    <ul class="tws-list">
      <li v-for="cue in WORSHIP_CUES" :key="cue" class="tws-row" :data-testid="`tw-sound-${cue}`">
        <div class="tws-row__head">
          <span class="tws-row__label">{{ tm(LABELS[cue]) }}</span>
          <span class="tws-row__name" :class="{ 'tws-row__name--default': !choices[cue] }">
            {{ choices[cue]?.name || tm("sounds.default") }}
          </span>
        </div>
        <div class="tws-row__actions">
          <LjButton
            size="sm"
            variant="ghost"
            :icon="ICONS.PLAYER.PLAY"
            :data-testid="`tw-sound-${cue}-play`"
            @click="$emit('preview', cue)"
          >
            {{ tm("sounds.listen") }}
          </LjButton>
          <LjButton
            size="sm"
            :icon="ICONS.MEDIA.LIBRARY"
            :data-testid="`tw-sound-${cue}-pick`"
            @click="openPicker(cue)"
          >
            {{ tm("sounds.pick") }}
          </LjButton>
          <LjButton
            v-if="choices[cue]"
            size="sm"
            variant="ghost"
            :icon="ICONS.ACTIONS.RESTORE"
            :data-testid="`tw-sound-${cue}-default`"
            @click="useDefault(cue)"
          >
            {{ tm("sounds.use_default") }}
          </LjButton>
        </div>
      </li>
    </ul>

    <LiturgyLibrarySearch
      v-model="pickerOpen"
      :title="tm('sounds.pick_title')"
      :icon="ICONS.MEDIA.LIBRARY"
      :items="libraryItems"
      :categories="libraryCategories"
      :selected-id="pickingFor ? choices[pickingFor]?.libraryId : undefined"
      :empty-text="tm('sounds.library_empty')"
      default-view="list"
      @pick="onPicked"
    />
  </LjDialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { LjButton, LjDialog } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import LiturgyLibrarySearch, {
  type LibrarySearchCategory,
  type LibrarySearchItem,
} from "@/modules/liturgy/components/LiturgyLibrarySearch.vue";
import { useModuleI18n } from "@/composables/useModuleI18n";
import {
  WORSHIP_CUES,
  getSoundChoice,
  listLibraryAudios,
  setSoundChoice,
  type WorshipCue,
  type WorshipSoundChoice,
} from "../sounds";

const props = defineProps<{ modelValue: boolean }>();
defineEmits<{
  "update:modelValue": [value: boolean];
  preview: [cue: WorshipCue];
}>();

const { tm } = useModuleI18n("timer_worship");

const LABELS: Record<WorshipCue, string> = {
  start: "sound.start",
  five: "sound.five_min",
  one: "sound.one_min",
};

const choices = reactive<Record<WorshipCue, WorshipSoundChoice | null>>({
  start: null,
  five: null,
  one: null,
});

function loadChoices(): void {
  for (const cue of WORSHIP_CUES) choices[cue] = getSoundChoice(cue);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) loadChoices();
  },
  { immediate: true }
);

const pickerOpen = ref(false);
const pickingFor = ref<WorshipCue | null>(null);
const libraryItems = ref<LibrarySearchItem[]>([]);
const libraryCategories = ref<LibrarySearchCategory[]>([]);

async function openPicker(cue: WorshipCue): Promise<void> {
  pickingFor.value = cue;
  const { items, categories } = await listLibraryAudios();
  libraryItems.value = items.map((i) => ({
    ...i,
    icon: ICONS.MEDIA.AUDIO,
    type: "audio",
    typeLabel: "AUDIO",
  }));
  libraryCategories.value = categories as LibrarySearchCategory[];
  pickerOpen.value = true;
}

function onPicked(item: LibrarySearchItem): void {
  const cue = pickingFor.value;
  pickerOpen.value = false;
  if (!cue) return;
  const choice = { libraryId: item.id, name: item.name };
  setSoundChoice(cue, choice);
  choices[cue] = choice;
}

function useDefault(cue: WorshipCue): void {
  setSoundChoice(cue, null);
  choices[cue] = null;
}
</script>

<style scoped>
.tws-intro {
  margin: 0 0 var(--lj-space-5);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.tws-list {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.tws-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-5);
  padding: var(--lj-space-4) var(--lj-space-5);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.tws-row__head {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tws-row__label {
  font-weight: var(--lj-weight-medium);
}

.tws-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--lj-text-sm);
}

.tws-row__name--default {
  color: var(--lj-text-subtle);
}

.tws-row__actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--lj-space-2);
}
</style>
