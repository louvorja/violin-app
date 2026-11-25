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

    <!-- Avisos a mais, em qualquer tempo, com áudio da Biblioteca de Mídia. -->
    <h3 class="tws-subtitle">{{ tm("sounds.extras_title") }}</h3>
    <p class="tws-intro">{{ tm("sounds.extras_intro") }}</p>
    <ul v-if="extras.length" class="tws-list">
      <li
        v-for="(cue, index) in extras"
        :key="cue.id"
        class="tws-row"
        :data-testid="`tw-extra-${index}`"
      >
        <div class="tws-row__head tws-row__head--extra">
          <label class="tws-when">
            <span>{{ tm("sounds.extras_when") }}</span>
            <span class="tws-when__box">
              <LjInput
                :model-value="timeText[cue.id] ?? formatCueTime(cue.seconds)"
                :aria-label="tm('sounds.extras_when')"
                :data-testid="`tw-extra-${index}-time`"
                @update:model-value="timeText[cue.id] = String($event)"
                @blur="commitTime(cue)"
                @keydown.enter="commitTime(cue)"
              />
            </span>
          </label>
          <span class="tws-row__name" :class="{ 'tws-row__name--missing': !cue.libraryId }">
            {{ cue.name || tm("sounds.extras_no_audio") }}
          </span>
        </div>
        <div class="tws-row__actions">
          <LjButton
            size="sm"
            variant="ghost"
            :icon="ICONS.PLAYER.PLAY"
            :disabled="!cue.libraryId"
            :data-testid="`tw-extra-${index}-play`"
            @click="$emit('previewExtra', { ...cue })"
          >
            {{ tm("sounds.listen") }}
          </LjButton>
          <LjButton
            size="sm"
            :icon="ICONS.MEDIA.LIBRARY"
            :data-testid="`tw-extra-${index}-pick`"
            @click="openPicker({ extra: cue.id })"
          >
            {{ tm("sounds.pick") }}
          </LjButton>
          <LjButton
            size="sm"
            variant="ghost"
            :icon="ICONS.ACTIONS.DELETE"
            :aria-label="tm('sounds.extras_remove')"
            :title="tm('sounds.extras_remove')"
            :data-testid="`tw-extra-${index}-remove`"
            @click="removeExtra(cue.id)"
          />
        </div>
      </li>
    </ul>
    <LjButton
      class="tws-add"
      variant="ghost"
      :icon="ICONS.ACTIONS.ADD"
      data-testid="tw-extra-add"
      @click="addExtra"
    >
      {{ tm("sounds.extras_add") }}
    </LjButton>

    <LiturgyLibrarySearch
      v-model="pickerOpen"
      :title="tm('sounds.pick_title')"
      :icon="ICONS.MEDIA.LIBRARY"
      :items="libraryItems"
      :categories="libraryCategories"
      :selected-id="pickedId"
      :empty-text="tm('sounds.library_empty')"
      default-view="list"
      @pick="onPicked"
    />
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { LjButton, LjDialog, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import LiturgyLibrarySearch, {
  type LibrarySearchCategory,
  type LibrarySearchItem,
} from "@/modules/liturgy/components/LiturgyLibrarySearch.vue";
import { useModuleI18n } from "@/composables/useModuleI18n";
import {
  WORSHIP_CUES,
  formatCueTime,
  getExtraCues,
  getSoundChoice,
  listLibraryAudios,
  parseCueTime,
  setExtraCues,
  setSoundChoice,
  type WorshipCue,
  type WorshipExtraCue,
  type WorshipSoundChoice,
} from "../sounds";

const props = defineProps<{ modelValue: boolean }>();
defineEmits<{
  "update:modelValue": [value: boolean];
  preview: [cue: WorshipCue];
  previewExtra: [cue: WorshipExtraCue];
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

const extras = ref<WorshipExtraCue[]>([]);
/** Texto sendo digitado no "Faltando" de cada aviso extra, até confirmar. */
const timeText = reactive<Record<string, string>>({});

function loadChoices(): void {
  for (const cue of WORSHIP_CUES) choices[cue] = getSoundChoice(cue);
  extras.value = getExtraCues();
  for (const key of Object.keys(timeText)) delete timeText[key];
}

function saveExtras(next: WorshipExtraCue[]): void {
  extras.value = next;
  setExtraCues(next);
}

/** Novo aviso faltando 10 min (ou 1 min a menos que o último, para não repetir). */
function addExtra(): void {
  const last = extras.value.at(-1);
  const seconds = last ? Math.max(60, last.seconds - 60) : 600;
  const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  saveExtras([...extras.value, { id, seconds, libraryId: "", name: "" }]);
}

function removeExtra(id: string): void {
  saveExtras(extras.value.filter((c) => c.id !== id));
  delete timeText[id];
}

/** Confirma o "Faltando": "10:00", "2:30" ou "5" (minutos). Inválido volta ao que era. */
function commitTime(cue: WorshipExtraCue): void {
  const typed = timeText[cue.id];
  delete timeText[cue.id];
  if (typed === undefined) return;
  const seconds = parseCueTime(typed);
  if (seconds === null || seconds === cue.seconds) return;
  // Mantém a lista do maior para o menor tempo, na ordem em que vão tocar.
  saveExtras(
    extras.value
      .map((c) => (c.id === cue.id ? { ...c, seconds } : c))
      .sort((a, b) => b.seconds - a.seconds)
  );
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) loadChoices();
  },
  { immediate: true }
);

const pickerOpen = ref(false);
/** Para quem é a escolha: um dos três fixos ou um aviso extra (pelo id). */
const pickingFor = ref<WorshipCue | { extra: string } | null>(null);
const pickedId = computed<string | undefined>(() => {
  const target = pickingFor.value;
  if (!target) return undefined;
  if (typeof target === "string") return choices[target]?.libraryId;
  return extras.value.find((c) => c.id === target.extra)?.libraryId || undefined;
});
const libraryItems = ref<LibrarySearchItem[]>([]);
const libraryCategories = ref<LibrarySearchCategory[]>([]);

async function openPicker(cue: WorshipCue | { extra: string }): Promise<void> {
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
  if (typeof cue !== "string") {
    saveExtras(
      extras.value.map((c) =>
        c.id === cue.extra ? { ...c, libraryId: item.id, name: item.name } : c
      )
    );
    return;
  }
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

.tws-row__name--missing {
  color: var(--lj-text-subtle);
  font-style: italic;
}

.tws-subtitle {
  margin: var(--lj-space-7) 0 var(--lj-space-2);
  font-size: var(--lj-text-md);
  font-weight: var(--lj-weight-medium);
}

.tws-row__head--extra {
  gap: var(--lj-space-2);
}

.tws-when {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  font-weight: var(--lj-weight-medium);
}

/* O LjInput estica até o fim da linha; a caixa fixa a largura de "10:00". */
.tws-when__box {
  width: 80px;
}

.tws-add {
  margin-top: var(--lj-space-3);
}

.tws-row__actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--lj-space-2);
}
</style>
