<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" @close="close()" @scroll="onScroll">
    <div v-if="favorites.length === 0" class="music-list-empty">
      <LjIcon :icon="ICONS.UI.STAR_OFF_OUTLINE" size="64" class="lj-u-faded" />
      <div class="music-list-empty-text">
        <div class="music-list-empty-title">{{ tm("data.empty") }}</div>
        <div class="music-list-empty-hint lj-u-faded">{{ tm("data.empty_hint") }}</div>
      </div>
    </div>

    <draggable
      v-else
      v-model="pageFavorites"
      item-key="id_music"
      handle=".drag-handle"
      class="music-list"
      role="list"
    >
      <template #item="{ element }">
        <div class="music-list-item" role="listitem">
          <LjIcon class="drag-handle" :icon="ICONS.ACTIONS.DRAG" size="small" color="grey" />
          <div class="music-list-item-info">
            <span class="music-list-item-name">{{ musicTitle(element) }}</span>
          </div>
          <div class="music-list-item-actions">
            <MusicMenuTable
              :id_music="element.id_music"
              :name="element.name"
              :music-subtitle="musicTitle(element, 'Música')"
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
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref, computed } from "vue";
import draggable from "vuedraggable";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import AppData from "@/helpers/AppData";
import Favorites from "@/helpers/Favorites";
import { useMusicReferences } from "@/composables/useMusicReferences";
import { musicTitle } from "@root/config/musicCatalog.mjs";

const moduleContainer = ref(null);
const PAGE_SIZE = 60;
const visibleLimit = ref(PAGE_SIZE);

const savedFavorites = computed(() => AppData.get("user_data.favorites", []));
const { items: visibleFavorites, reorder } = useMusicReferences(savedFavorites);
const favorites = computed({
  get: () => visibleFavorites.value,
  set: (val) => Favorites.reorder(reorder(val)),
});
const pageFavorites = computed({
  get: () => favorites.value.slice(0, visibleLimit.value),
  // O arraste reordena só a parte montada. As próximas páginas e as referências
  // ocultas por álbuns desativados conservam seus lugares no conjunto salvo.
  set: (val) => {
    favorites.value = [...val, ...favorites.value.slice(visibleLimit.value)];
  },
});

function onScroll(payload) {
  if (
    typeof payload?.scroll_bottom === "number" &&
    payload.scroll_bottom <= 150 &&
    visibleLimit.value < favorites.value.length
  ) {
    visibleLimit.value += PAGE_SIZE;
  }
}

const tm = (key) => moduleContainer.value?.tm(key) || key;

function extraMenu(item) {
  return [
    {
      title: tm("actions.remove"),
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
