<template>
  <LjDialog
    :model-value="modelValue"
    :title="tm('intercessory.title')"
    :icon="ICONS.MUSIC.PLAYBACK"
    size="md"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="ibd-intro">{{ tm("intercessory.intro") }}</p>

    <div class="ibd-current" data-testid="intercessory-current">
      <span class="ibd-current__label">{{ tm("intercessory.current") }}</span>
      <span class="ibd-current__name" :class="{ 'ibd-current__name--none': !choice }">
        {{ choice ? choice.name : tm("intercessory.none") }}
      </span>
      <span v-if="choice" class="ibd-current__source">
        {{
          choice.source === "background_sound"
            ? tm("intercessory.from_bg")
            : tm("intercessory.from_library")
        }}
      </span>
    </div>

    <div class="ibd-actions">
      <LjButton
        :icon="ICONS.MUSIC.PLAYBACK"
        data-testid="intercessory-pick-bg"
        @click="openPicker('background_sound')"
      >
        {{ tm("intercessory.pick_bg") }}
      </LjButton>
      <LjButton
        :icon="ICONS.MEDIA.LIBRARY"
        data-testid="intercessory-pick-library"
        @click="openPicker('media_library')"
      >
        {{ tm("intercessory.pick_library") }}
      </LjButton>
      <LjButton
        v-if="choice"
        variant="ghost"
        :icon="ICONS.PLAYER.PLAY"
        data-testid="intercessory-preview"
        @click="preview"
      >
        {{ tm("intercessory.preview") }}
      </LjButton>
      <LjButton
        v-if="choice"
        variant="ghost"
        :icon="ICONS.ACTIONS.CLOSE"
        data-testid="intercessory-clear"
        @click="clear"
      >
        {{ tm("intercessory.clear") }}
      </LjButton>
    </div>

    <LiturgyLibrarySearch
      v-model="pickerOpen"
      :title="
        pickerSource === 'background_sound'
          ? tm('intercessory.pick_bg')
          : tm('intercessory.pick_library')
      "
      :icon="pickerSource === 'background_sound' ? ICONS.MUSIC.PLAYBACK : ICONS.MEDIA.LIBRARY"
      :items="pickerItems"
      :categories="pickerCategories"
      :selected-id="choice?.source === pickerSource ? choice?.id : undefined"
      default-view="list"
      @pick="onPicked"
    />
  </LjDialog>
</template>

<script setup lang="ts">
/**
 * Fundo musical da Oração Intercessória: o que toca, no Som de Fundo, depois
 * que a locução termina. Pode vir do próprio Som de Fundo ou de um áudio da
 * Biblioteca de Mídia, e é trocado quantas vezes quiser.
 */
import { ref, watch } from "vue";
import { LjButton, LjDialog } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import { useModuleI18n } from "@/composables/useModuleI18n";
import LiturgyLibrarySearch, {
  type LibrarySearchCategory,
  type LibrarySearchItem,
} from "@/modules/liturgy/components/LiturgyLibrarySearch.vue";
import {
  getIntercessoryBackground,
  playIntercessoryBackground,
  setIntercessoryBackground,
  type IntercessoryBackground,
} from "@/helpers/LiturgicalAudios";
import { INTERCESSORY_PRAYER_ID } from "@/config/LiturgicalAudios";

const props = defineProps<{ modelValue: boolean }>();
defineEmits<{ "update:modelValue": [value: boolean] }>();

const { tm } = useModuleI18n("media_library");

const choice = ref<IntercessoryBackground | null>(null);
watch(
  () => props.modelValue,
  (open) => {
    if (open) choice.value = getIntercessoryBackground();
  },
  { immediate: true }
);

const pickerOpen = ref(false);
const pickerSource = ref<IntercessoryBackground["source"]>("background_sound");
const pickerItems = ref<LibrarySearchItem[]>([]);
const pickerCategories = ref<LibrarySearchCategory[]>([]);

interface Row {
  id: string;
  name?: string;
  fileName?: string;
  type?: string;
  categoryId?: string;
}

async function openPicker(source: IntercessoryBackground["source"]): Promise<void> {
  pickerSource.value = source;
  const isBg = source === "background_sound";
  const [rows, categories] = await Promise.all([
    $idb
      .getAll<Row>(isBg ? DB_TABLE.BACKGROUND_SOUND_LIBRARY : DB_TABLE.MEDIA_LIBRARY)
      .catch(() => [] as Row[]),
    $idb
      .getAll<LibrarySearchCategory>(
        isBg ? DB_TABLE.BACKGROUND_SOUND_CATEGORY : DB_TABLE.MEDIA_LIBRARY_CATEGORY
      )
      .catch(() => [] as LibrarySearchCategory[]),
  ]);
  const items = rows
    // Na biblioteca, só áudio — e não a própria locução.
    .filter((r) => isBg || (r.type === "audio" && r.id !== INTERCESSORY_PRAYER_ID))
    .map((r) => ({
      id: r.id,
      name: r.fileName || r.name || r.id,
      categoryId: r.categoryId,
      icon: isBg ? ICONS.MUSIC.PLAYBACK : ICONS.MEDIA.AUDIO,
      type: "audio",
    }));
  const used = new Set(items.map((i) => i.categoryId).filter(Boolean));
  pickerItems.value = items;
  pickerCategories.value = categories.filter((c) => used.has(c.id));
  pickerOpen.value = true;
}

function onPicked(item: LibrarySearchItem): void {
  pickerOpen.value = false;
  const next = { source: pickerSource.value, id: item.id, name: item.name };
  setIntercessoryBackground(next);
  choice.value = next;
}

function clear(): void {
  setIntercessoryBackground(null);
  choice.value = null;
}

function preview(): void {
  void playIntercessoryBackground(choice.value);
}
</script>

<style scoped>
.ibd-intro {
  margin: 0 0 var(--lj-space-5);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.ibd-current {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4) var(--lj-space-5);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.ibd-current__label {
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.ibd-current__name {
  font-weight: var(--lj-weight-medium);
}

.ibd-current__name--none {
  color: var(--lj-text-subtle);
  font-style: italic;
  font-weight: normal;
}

.ibd-current__source {
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
}

.ibd-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-3);
  margin-top: var(--lj-space-5);
}
</style>
