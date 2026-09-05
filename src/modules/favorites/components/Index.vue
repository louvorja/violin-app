<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" @close="close()">
    <div v-if="favorites.length === 0" class="music-list-empty">
      <Icon :icon="ICONS.UI.STAR_OFF_OUTLINE" size="64" class="lj-u-faded" />
      <div class="music-list-empty-text">
        <div class="music-list-empty-title">{{ t("data.empty") }}</div>
        <div class="music-list-empty-hint lj-u-faded">{{ t("data.empty_hint") }}</div>
      </div>
    </div>

    <draggable
      v-else
      v-model="favorites"
      item-key="id_music"
      handle=".drag-handle"
      class="music-list"
      role="list"
    >
      <template #item="{ element }">
        <div class="music-list-item" role="listitem">
          <Icon class="drag-handle" :icon="ICONS.ACTIONS.DRAG" size="small" color="grey" />
          <div class="music-list-item-info">
            <span class="music-list-item-name">{{ element.name }}</span>
          </div>
          <div class="music-list-item-actions">
            <MusicMenuTable
              :id_music="element.id_music"
              :name="element.name"
              :has_instrumental_music="element.has_instrumental_music"
              :extra-menu="extraMenu(element)"
            />
          </div>
        </div>
      </template>
    </draggable>
  </ModuleContainer>
</template>

<script setup>
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import { ref, computed } from "vue";
import draggable from "vuedraggable";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import AppData from "@/helpers/AppData";
import Favorites from "@/helpers/Favorites";

const moduleContainer = ref(null);

const favorites = computed({
  get: () => AppData.get("user_data.favorites", []),
  set: (val) => Favorites.reorder(val),
});

const t = (key) => moduleContainer.value?.t(key) || key;

function extraMenu(item) {
  return [
    {
      title: t("actions.remove"),
      icon: ICONS.UI.STAR_OFF,
      click: () => Favorites.remove(item.id_music),
    },
  ];
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

.drag-handle {
  cursor: grab;
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

.music-list-item-actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  flex-shrink: 0;
}
</style>
