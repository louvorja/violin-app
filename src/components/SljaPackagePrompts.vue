<template>
  <LjDialog
    v-if="trackDialogOpen"
    v-model="trackDialogOpen"
    :title="t('shell.slja.track_title')"
    :icon="ICONS.MUSIC.NOTE"
    size="sm"
  >
    <p class="slja-prompt-desc">
      {{
        t(
          legacyItems.length > 1
            ? "shell.slja.track_description_multi"
            : "shell.slja.track_description"
        )
      }}
    </p>

    <div v-if="legacyItems.length > 1" class="slja-batch-actions">
      <LjButton size="sm" variant="ghost" @click="applyToAll('cantado')">
        {{ t("shell.slja.all_sung") }}
      </LjButton>
      <LjButton size="sm" variant="ghost" @click="applyToAll('playback')">
        {{ t("shell.slja.all_playback") }}
      </LjButton>
    </div>

    <div class="slja-track-list">
      <div v-for="item in legacyItems" :key="item.key" class="slja-track-row">
        <div class="slja-track-meta">
          <div class="slja-track-song lj-u-truncate">{{ item.songName }}</div>
          <div class="slja-track-file lj-u-truncate">{{ item.fileName }}</div>
        </div>
        <div class="slja-track-toggle" role="group" :aria-label="item.songName">
          <button
            type="button"
            class="slja-toggle-btn"
            :class="{ 'is-active': trackChoices[item.key] === 'cantado' }"
            data-testid="slja-choice-cantado"
            @click="trackChoices[item.key] = 'cantado'"
          >
            {{ t("shell.slja.track_sung") }}
          </button>
          <button
            type="button"
            class="slja-toggle-btn"
            :class="{ 'is-active': trackChoices[item.key] === 'playback' }"
            data-testid="slja-choice-playback"
            @click="trackChoices[item.key] = 'playback'"
          >
            {{ t("shell.slja.track_playback") }}
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <LjButton size="sm" @click="cancelTrackDialog">{{ t("shell.slja.cancel") }}</LjButton>
      <LjButton
        size="sm"
        variant="primary"
        data-testid="slja-confirm-import"
        @click="confirmTrackDialog"
      >
        {{ t("shell.slja.import_confirm") }}
      </LjButton>
    </template>
  </LjDialog>

  <LjDialog
    v-if="exportDialogOpen"
    v-model="exportDialogOpen"
    :title="t('shell.slja.export_title')"
    :icon="ICONS.ACTIONS.EXPORT_FILE"
    size="sm"
  >
    <p class="slja-prompt-desc">{{ t("shell.slja.export_description") }}</p>

    <div class="slja-export-options">
      <button
        type="button"
        class="slja-export-option"
        data-testid="slja-export-unified"
        @click="pickExportMode('unified')"
      >
        <LjIcon :icon="ICONS.MUSIC.NOTE_EIGHTH" :size="20" class="slja-export-icon" />
        <span class="slja-export-copy">
          <strong>{{ t("shell.slja.export_unified_title") }}</strong>
          <small>{{ t("shell.slja.export_unified_hint") }}</small>
        </span>
      </button>

      <button
        type="button"
        class="slja-export-option"
        data-testid="slja-export-classic"
        @click="pickExportMode('classic')"
      >
        <LjIcon :icon="ICONS.UI.FOLDER_MULTIPLE" :size="20" class="slja-export-icon" />
        <span class="slja-export-copy">
          <strong>{{ t("shell.slja.export_classic_title") }}</strong>
          <small>{{ t("shell.slja.export_classic_hint") }}</small>
        </span>
      </button>
    </div>

    <template #footer>
      <LjButton size="sm" @click="pickExportMode(null)">{{ t("shell.slja.cancel") }}</LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { i18nAtual } from "@/i18n";
import { LjButton, LjDialog, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import type {
  LegacyTrackPromptItem,
  SljaExportMode,
  SljaTrackKind,
} from "@/helpers/CustomSongPackage";

const t = (key: string): string => {
  const g = i18nAtual()?.global;
  return g ? String(g.t(key)) : key;
};

const trackDialogOpen = ref(false);
const legacyItems = ref<LegacyTrackPromptItem[]>([]);
const trackChoices = reactive<Record<string, SljaTrackKind>>({});
let trackResolver: ((_value: Record<string, SljaTrackKind> | null) => void) | null = null;

function applyToAll(kind: SljaTrackKind): void {
  for (const item of legacyItems.value) {
    trackChoices[item.key] = kind;
  }
}

function finishTrackDialog(value: Record<string, SljaTrackKind> | null): void {
  const resolve = trackResolver;
  trackResolver = null;
  trackDialogOpen.value = false;
  resolve?.(value);
}

function confirmTrackDialog(): void {
  const result: Record<string, SljaTrackKind> = {};
  for (const item of legacyItems.value) {
    result[item.key] = trackChoices[item.key] === "playback" ? "playback" : "cantado";
  }
  finishTrackDialog(result);
}

function cancelTrackDialog(): void {
  finishTrackDialog(null);
}

watch(trackDialogOpen, (open) => {
  if (!open && trackResolver) finishTrackDialog(null);
});

async function classifyLegacyTracks(
  items: LegacyTrackPromptItem[]
): Promise<Record<string, SljaTrackKind> | null> {
  if (!items.length) return {};
  if (trackResolver) finishTrackDialog(null);
  legacyItems.value = items;
  for (const k of Object.keys(trackChoices)) delete trackChoices[k];
  for (const item of items) trackChoices[item.key] = "cantado";
  trackDialogOpen.value = true;
  return new Promise((resolve) => {
    trackResolver = resolve;
  });
}

async function classifyLegacyTrack(item: LegacyTrackPromptItem): Promise<SljaTrackKind | null> {
  const result = await classifyLegacyTracks([item]);
  return result ? (result[item.key] ?? "cantado") : null;
}

const exportDialogOpen = ref(false);
let exportResolver: ((_mode: SljaExportMode | null) => void) | null = null;

function pickExportMode(mode: SljaExportMode | null): void {
  const resolve = exportResolver;
  exportResolver = null;
  exportDialogOpen.value = false;
  resolve?.(mode);
}

watch(exportDialogOpen, (open) => {
  if (!open && exportResolver) pickExportMode(null);
});

async function chooseExportMode(): Promise<SljaExportMode | null> {
  if (exportResolver) pickExportMode(null);
  exportDialogOpen.value = true;
  return new Promise((resolve) => {
    exportResolver = resolve;
  });
}

defineExpose({
  classifyLegacyTracks,
  classifyLegacyTrack,
  chooseExportMode,
});
</script>

<style scoped>
.slja-prompt-desc {
  margin: 0 0 var(--lj-space-3);
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  line-height: 1.45;
}

.slja-batch-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--lj-space-2);
  margin-bottom: var(--lj-space-2);
}

.slja-track-list {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  max-height: 280px;
  overflow-y: auto;
}

.slja-track-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-3);
  padding: var(--lj-space-2) var(--lj-space-3);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
}

.slja-track-meta {
  min-width: 0;
  flex: 1;
}

.slja-track-song {
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

.slja-track-file {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
}

.slja-track-toggle {
  display: inline-flex;
  flex-shrink: 0;
  border-radius: var(--lj-radius-md);
  border: 1px solid var(--lj-surface-border);
  overflow: hidden;
}

.slja-toggle-btn {
  border: 0;
  background: transparent;
  color: var(--lj-text-muted);
  font-family: inherit;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  padding: 5px 10px;
  cursor: pointer;
  transition:
    background var(--lj-transition-fast),
    color var(--lj-transition-fast);
}

.slja-toggle-btn.is-active {
  background: var(--lj-ui-accent);
  color: var(--lj-white);
}

.slja-export-options {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}

.slja-export-option {
  display: flex;
  align-items: flex-start;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3);
  border-radius: var(--lj-radius-md);
  border: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--lj-transition-fast),
    background var(--lj-transition-fast);
}

.slja-export-option:hover {
  border-color: var(--lj-ui-accent);
  background: var(--lj-ui-accent-soft);
}

.slja-export-icon {
  flex-shrink: 0;
  color: var(--lj-ui-accent);
  margin-top: 2px;
}

.slja-export-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.slja-export-copy strong {
  font-size: var(--lj-text-base);
}

.slja-export-copy small {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
  line-height: 1.35;
}
</style>
