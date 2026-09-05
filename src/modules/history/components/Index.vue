<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" @close="close()">
    <template #right>
      <LjButton
        v-if="history.length"
        variant="ghost"
        :icon="ICONS.ACTIONS.DELETE"
        :title="t('actions.clear')"
        icon-only
        @click="clearHistory()"
      />
    </template>

    <div v-if="history.length === 0" class="music-list-empty">
      <Icon :icon="ICONS.MODULES.HISTORY" size="64" class="lj-u-faded" />
      <div class="music-list-empty-text">
        <div class="music-list-empty-title">{{ t("data.empty") }}</div>
        <div class="music-list-empty-hint lj-u-faded">{{ t("data.empty_hint") }}</div>
      </div>
    </div>

    <div v-else class="music-list" role="list">
      <div v-for="item in history" :key="item.id_music" class="music-list-item" role="listitem">
        <div class="music-list-item-info">
          <span class="music-list-item-name">{{ item.name }}</span>
          <span class="music-list-item-meta">{{ relativeDate(item.opened_at) }}</span>
        </div>
        <div class="music-list-item-actions">
          <MusicMenuTable
            :id_music="item.id_music"
            :name="item.name"
            :has_instrumental_music="item.has_instrumental_music"
          />
          <LjButton
            variant="danger"
            size="sm"
            :icon="ICONS.ACTIONS.CLOSE"
            :title="t('actions.remove')"
            icon-only
            @click.stop="removeFromHistory(item.id_music)"
          />
        </div>
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup>
import { LjButton } from "@/components/ui";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import { ref, computed } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import AppData from "@/helpers/AppData";
import History from "@/helpers/History";

const moduleContainer = ref(null);

const history = computed(() => AppData.get("user_data.history", []));

const t = (key) => moduleContainer.value?.t(key) || key;

function relativeDate(ts) {
  if (!ts) return "";
  const now = Date.now();
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return t("time.now");
  if (diff < 3600) return t("time.minutes").replace("[n]", Math.floor(diff / 60));
  if (diff < 86400) return t("time.hours").replace("[n]", Math.floor(diff / 3600));

  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return t("time.yesterday");
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear
      ? { day: "2-digit", month: "short" }
      : { day: "2-digit", month: "2-digit", year: "2-digit" }
  );
}

function clearHistory() {
  History.clear();
}

function removeFromHistory(id) {
  History.remove(id);
}

function close() {}
</script>

<style scoped>
.music-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-6);
  padding: var(--lj-space-8);
  text-align: center;
}

.music-list-empty-text {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

.music-list-empty-title {
  font-size: var(--lj-text-lg);
}

.music-list-empty-hint {
  font-size: var(--lj-text-base);
}

.music-list-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  min-height: 36px;
  padding: var(--lj-space-3) var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-divider);
  transition: background var(--lj-transition-fast);
}

.music-list-item:hover {
  background: var(--lj-surface-bg-hover);
}

.music-list-item-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.music-list-item-name {
  font-size: var(--lj-text-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-list-item-meta {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
}

.music-list-item-actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  flex-shrink: 0;
}
</style>
