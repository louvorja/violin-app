<template>
  <span class="pm-online-src__group">{{ tm("library.online") }}</span>
  <button
    type="button"
    class="pm-online-src"
    :class="{ 'pm-online-src--active': active && online.openId.value === VIDEOS }"
    data-testid="pm-online-videos"
    @click="open(VIDEOS)"
  >
    <LjIcon :icon="ICONS.MEDIA.YOUTUBE" :size="15" />
    <span class="pm-online-src__label">{{ tm("online.videos") }}</span>
    <span class="pm-online-src__count">{{ online.videos.value.length || "" }}</span>
  </button>
  <draggable
    :model-value="online.collections.value"
    item-key="id"
    tag="div"
    class="pm-online-src__list"
    :animation="150"
    ghost-class="pm-online-src--ghost"
    @update:model-value="(list: OnlineCollectionFavorite[]) => online.reorder(list)"
  >
    <template #item="{ element: fav }">
      <div
        class="pm-online-src pm-online-src--user"
        :class="{ 'pm-online-src--active': active && online.openId.value === fav.id }"
        role="button"
        tabindex="0"
        :title="
          fav.channel && fav.kind === 'playlist' ? `${fav.title} · ${fav.channel}` : fav.title
        "
        :data-testid="`pm-online-src-${fav.ytId}`"
        @click="open(fav.id)"
        @keydown.enter.self="open(fav.id)"
      >
        <img
          v-if="fav.kind === 'channel' && fav.thumbnail"
          :src="fav.thumbnail"
          alt=""
          class="pm-online-src__avatar"
        />
        <LjIcon
          v-else
          :icon="fav.kind === 'channel' ? ICONS.UI.ACCOUNT : ICONS.MEDIA.PLAYLIST"
          :size="15"
        />
        <span class="pm-online-src__label">{{ fav.title }}</span>
        <button
          type="button"
          class="pm-online-src__remove"
          :title="tm('online.remove')"
          :aria-label="tm('online.remove')"
          @click.stop="confirmRemoveFavorite(fav)"
        >
          <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="11" />
        </button>
      </div>
    </template>
  </draggable>
  <button
    type="button"
    class="pm-online-src pm-online-src--add"
    data-testid="pm-online-add"
    @click="emit('add')"
  >
    <LjIcon :icon="ICONS.UI.LINK" :size="15" />
    <span class="pm-online-src__label">{{ tm("online.add") }}</span>
  </button>
</template>

<script setup lang="ts">
import draggable from "vuedraggable";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import {
  confirmRemoveFavorite,
  useOnlineLibrary,
  VIDEOS,
  type OnlineCollectionFavorite,
} from "../composables/useOnlineLibrary";

/**
 * O grupo Online da barra lateral da aba Mídia: os vídeos favoritos, as
 * playlists e os canais do YouTube, e o "Adicionar link". Abrir um deles
 * mostra a grade on-line no lugar da grade de arquivos.
 */

defineProps<{
  /** A grade on-line é a que está à vista. */
  active: boolean;
}>();
const emit = defineEmits<{ open: []; add: [] }>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const online = useOnlineLibrary();

function open(id: string): void {
  emit("open");
  void online.open(id, locale.value);
}
</script>

<style scoped>
.pm-online-src__group {
  padding: 8px 9px 3px 12px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--lj-text-subtle);
}

.pm-online-src__list {
  display: flex;
  flex-direction: column;
}

.pm-online-src {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  flex-shrink: 0;
  padding: 0 8px 0 9px;
  border: none;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--lj-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms var(--lj-ease);
}

.pm-online-src:hover {
  background: var(--lj-hover-bg);
}

.pm-online-src :deep(svg) {
  flex-shrink: 0;
  color: var(--lj-orange);
}

.pm-online-src--active {
  background: var(--lj-live-active-bg);
  border-left-color: var(--lj-orange);
}

.pm-online-src--user {
  cursor: grab;
}

.pm-online-src--ghost {
  opacity: 0.5;
}

.pm-online-src--add {
  color: var(--lj-orange);
}

.pm-online-src__label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-online-src__count {
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10px;
  color: var(--lj-text-subtle);
}

.pm-online-src__avatar {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
}

.pm-online-src__remove {
  display: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-text-muted);
  cursor: pointer;
}

.pm-online-src--user:hover .pm-online-src__remove,
.pm-online-src__remove:focus-visible {
  display: flex;
}
</style>
