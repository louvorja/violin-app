<template>
  <div class="pm-bgs" data-testid="pm-library-background-sound">
    <div class="pm-bgs__main">
      <aside class="pm-bgs__side" :aria-label="tm('library.background_sound_categories')">
        <div class="pm-bgs__search">
          <LjInput
            v-model="search"
            size="sm"
            :icon="ICONS.ACTIONS.SEARCH"
            :placeholder="t('components.ui.search_placeholder')"
            clearable
            data-testid="pm-bgs-search"
          />
        </div>
        <div
          class="pm-bgs__chips"
          role="group"
          :aria-label="tm('library.background_sound_categories')"
        >
          <CategoryListItem
            category-id="*"
            :name="tm('library.all')"
            :icon="ICONS.MODULES.BACKGROUND_SOUND"
            icon-type="icon"
            color="var(--lj-orange)"
            :count="bgs.records.value.length"
            :active="bgs.filter.value === BACKGROUND_SOUND_ALL"
            @select="bgs.filter.value = BACKGROUND_SOUND_ALL"
          />
          <CategoryListItem
            v-for="category in bgs.categories.value"
            :key="category.id"
            :category-id="category.id"
            :name="category.name"
            :icon="chipIcon(category)"
            :icon-type="chipIconType(category)"
            :color="category.color || 'var(--lj-orange)'"
            :count="bgs.countOf(category.id)"
            :active="bgs.filter.value === category.id"
            @select="bgs.filter.value = category.id"
          />
          <CategoryListItem
            v-if="bgs.hasUncategorized.value"
            category-id=""
            :name="t('shell.category.uncategorized')"
            :icon="ICONS.CATEGORY.FOLDER"
            icon-type="icon"
            color="var(--lj-orange)"
            :count="bgs.countOf(BACKGROUND_SOUND_UNCATEGORIZED)"
            :active="bgs.filter.value === BACKGROUND_SOUND_UNCATEGORIZED"
            @select="bgs.filter.value = BACKGROUND_SOUND_UNCATEGORIZED"
          />
        </div>
      </aside>

      <div class="pm-bgs__content">
        <div class="pm-bgs__body">
          <p v-if="bgs.loading.value && !bgs.loaded.value" class="pm-bgs__empty">
            {{ tm("library.loading") }}
          </p>
          <LjEmpty
            v-else-if="!bgs.records.value.length"
            :icon="ICONS.MODULES.BACKGROUND_SOUND"
            :title="tm('library.background_sound_empty')"
          />
          <p v-else-if="!visible.length" class="pm-bgs__empty">
            {{ tm("library.background_sound_no_results") }}
          </p>
          <div v-else class="pm-bgs__grid">
            <LjContextMenu
              v-for="card in visibleCards"
              :key="card.record.id"
              v-bind="menuFor(card.record)"
            >
              <div
                class="pm-bgs__card"
                :class="{
                  'pm-bgs__card--current': card.record.id === currentId,
                  'pm-bgs__card--playing': card.record.id === currentId && bg.isPlaying.value,
                }"
                :style="{ '--pm-bgs-card-color': card.color }"
                role="button"
                tabindex="0"
                :data-testid="`pm-bgs-card-${card.record.id}`"
                :title="bgs.displayName(card.record)"
                :aria-label="
                  (card.record.id === currentId && bg.isPlaying.value
                    ? tm('library.background_sound_pause')
                    : tm('library.background_sound_play')) +
                  ': ' +
                  bgs.displayName(card.record)
                "
                @click="toggle(card.record)"
                @keydown.enter.prevent="toggle(card.record)"
                @keydown.space.prevent="toggle(card.record)"
              >
                <span class="pm-bgs__play">
                  <LjIcon
                    :icon="
                      card.record.id === currentId && bg.isPlaying.value
                        ? ICONS.PLAYER.PAUSE
                        : ICONS.PLAYER.PLAY
                    "
                    :size="17"
                  />
                </span>
                <span class="pm-bgs__info">
                  <span class="pm-bgs__name">{{ bgs.displayName(card.record) }}</span>
                  <span class="pm-bgs__category">
                    <img
                      v-if="card.iconType === 'image'"
                      :src="card.icon"
                      class="pm-bgs__category-icon"
                      alt=""
                    />
                    <LjIcon
                      v-else
                      :icon="card.icon"
                      :size="12"
                      :style="{ color: card.color }"
                      class="pm-bgs__category-icon"
                    />
                    <span class="pm-bgs__category-name">{{ card.categoryName }}</span>
                  </span>
                </span>
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.ADD"
                  :title="tm('library.add_to_program')"
                  :aria-label="tm('library.add_to_program')"
                  :data-testid="`pm-bgs-add-${card.record.id}`"
                  @click.stop="add(card.record)"
                  @keydown.stop
                />
              </div>
            </LjContextMenu>
          </div>
        </div>

        <footer class="pm-bgs__foot">
          <LjIcon :icon="ICONS.MODULES.BACKGROUND_SOUND" :size="12" />
          <span>{{ countLabel }}</span>
          <span class="pm-bgs__spacer" />
          <LjButton
            size="sm"
            variant="ghost"
            :icon="ICONS.UI.OPEN_IN_NEW"
            :title="tm('library.background_sound_manage')"
            data-testid="pm-bgs-manage"
            @click="openModule"
          >
            {{ tm("library.background_sound_manage") }}
          </LjButton>
        </footer>
      </div>
    </div>

    <Transition name="pm-bgs-player">
      <BackgroundSoundPlayer v-if="bg.currentFile.value" embedded data-testid="pm-bgs-player" />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from "vue";
import {
  LjButton,
  LjContextMenu,
  LjEmpty,
  LjIcon,
  LjInput,
  type LjMenuItem,
} from "@/components/ui";
import BackgroundSoundPlayer from "@/components/BackgroundSoundPlayer.vue";
import CategoryListItem from "./CategoryListItem.vue";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import Modules from "@/helpers/Modules";
import $snackbar from "@/helpers/Snackbar";
import Strings from "@/helpers/Strings";
import { resolveBackgroundSoundPath } from "@/helpers/BackgroundSoundPath";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useBackgroundSound } from "@/composables/useBackgroundSound";
import type { ProgramItem } from "@/types/Presentation";
import { backgroundSoundItem } from "../program/items";
import {
  BACKGROUND_SOUND_ALL,
  BACKGROUND_SOUND_UNCATEGORIZED,
  useBackgroundSoundLibrary,
  type BackgroundSoundCategory,
  type BackgroundSoundRecord,
} from "../composables/useBackgroundSoundLibrary";

/**
 * Aba Sons de fundo da biblioteca. O som não é conteúdo de palco: o cartão
 * toca/pausa no player do módulo Som de Fundo, e o `+` acrescenta ao programa
 * como um item `BG_SOUND` — que o motor da liturgia já sabe executar.
 */

const emit = defineEmits<{ add: [item: ProgramItem] }>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const bg = useBackgroundSound();
const bgs = useBackgroundSoundLibrary();

const search = ref("");

const currentId = computed(() => bg.currentFile.value?.id ?? null);

const visible = computed(() => {
  const query = Strings.fold(search.value.trim());
  if (!query) return bgs.filtered.value;
  return bgs.filtered.value.filter((record) =>
    Strings.fold(bgs.displayName(record)).includes(query)
  );
});

interface SoundCard {
  record: BackgroundSoundRecord;
  color: string;
  icon: string;
  iconType: "icon" | "image";
  categoryName: string;
}

const visibleCards = computed<SoundCard[]>(() =>
  visible.value.map((record) => {
    const category = bgs.categoryOf(record);
    return {
      record,
      color: category?.color || "#607d8b",
      icon: category ? chipIcon(category) : ICONS.MUSIC.NOTE_OUTLINE,
      iconType: category ? chipIconType(category) : "icon",
      categoryName: category?.name || t("shell.category.uncategorized"),
    };
  })
);

const countLabel = computed(() =>
  t(`modules.${ModuleEnum.PRESENTATION_MODE}.library.background_sound_count`, visible.value.length)
);

function chipIcon(category: BackgroundSoundCategory): string {
  const image = bgs.categoryImageOf(category);
  if (image) return image;
  return category.iconType === "image"
    ? ICONS.MEDIA.IMAGE
    : category.icon || ICONS.MUSIC.NOTE_OUTLINE;
}

function chipIconType(category: BackgroundSoundCategory): "icon" | "image" {
  return bgs.categoryImageOf(category) ? "image" : "icon";
}

function toggle(record: BackgroundSoundRecord): void {
  if (currentId.value === record.id) {
    bg.togglePlay();
    return;
  }
  const path = resolveBackgroundSoundPath(record);
  if (!path) {
    $snackbar.error(tm("library.background_sound_unplayable"));
    return;
  }
  bg.playFile({
    id: record.id,
    name: bgs.displayName(record),
    fileName: record.fileName || bgs.displayName(record),
    path,
    data: record.data,
    mime: record.mime,
    size: record.size,
  });
}

function menuFor(record: BackgroundSoundRecord): {
  quick: LjMenuItem[];
  items: LjMenuItem[];
} {
  const isCurrent = currentId.value === record.id;
  const playing = isCurrent && bg.isPlaying.value;
  return {
    quick: [
      {
        label: playing ? tm("library.background_sound_pause") : tm("library.background_sound_play"),
        icon: playing ? ICONS.PLAYER.PAUSE : ICONS.PLAYER.PLAY,
        action: () => toggle(record),
      },
      {
        label: tm("library.add_to_program"),
        icon: ICONS.ACTIONS.ADD,
        action: () => add(record),
      },
    ],
    items: [
      ...(isCurrent
        ? [
            {
              label: tm("library.stop"),
              icon: ICONS.PLAYER.STOP_CIRCLE,
              action: () => bg.stop(),
            },
          ]
        : []),
      { separator: true },
      {
        label: tm("library.background_sound_manage"),
        icon: ICONS.UI.OPEN_IN_NEW,
        action: openModule,
      },
    ],
  };
}

function add(record: BackgroundSoundRecord): void {
  emit(
    "add",
    backgroundSoundItem(
      { id: record.id, name: bgs.displayName(record), fileName: record.fileName },
      bgs.categoryOf(record)?.name
    )
  );
}

function openModule(): void {
  Modules.open(ModuleEnum.BACKGROUND_SOUND);
}

onMounted(() => void bgs.load());
onActivated(() => {
  if (bgs.loaded.value) void bgs.load();
});
onBeforeUnmount(() => bgs.disposeCategoryIcons());
</script>

<style scoped>
.pm-bgs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pm-bgs__main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
}

.pm-bgs__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--lj-surface-border);
}

.pm-bgs__search {
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-3) 0;
}

.pm-bgs__search :deep(.lj-input) {
  width: 100%;
  min-width: 0;
}

.pm-bgs__chips {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: var(--lj-space-2) 0;
  scrollbar-width: none;
}

.pm-bgs__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pm-bgs__body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--lj-space-3) var(--lj-space-4);
}

.pm-bgs__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--lj-space-2);
  align-content: start;
}

.pm-bgs__card {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-width: 0;
  padding: var(--lj-space-2) var(--lj-space-3);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-md);
  background: color-mix(in srgb, var(--pm-bgs-card-color) 8%, var(--lj-surface-bg-soft));
  color: var(--lj-text);
  cursor: pointer;
}

.pm-bgs__card:hover,
.pm-bgs__card:focus-visible {
  background: color-mix(in srgb, var(--pm-bgs-card-color) 14%, var(--lj-surface-bg-soft));
}

.pm-bgs__card--current {
  border-color: var(--lj-ui-accent);
}

.pm-bgs__card--playing {
  border-color: var(--lj-orange);
}

.pm-bgs__play {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--lj-ui-accent-soft);
  color: var(--lj-text);
}

.pm-bgs__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.pm-bgs__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-sm);
}

.pm-bgs__category {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--lj-text-subtle);
  font-size: 10px;
}

.pm-bgs__category-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  object-fit: contain;
}

.pm-bgs__category-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pm-bgs__empty {
  margin: 0;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.pm-bgs__foot {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-2) var(--lj-space-4);
  border-top: 1px solid var(--lj-surface-border);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.pm-bgs__spacer {
  flex: 1;
}

.pm-bgs-player-enter-active,
.pm-bgs-player-leave-active {
  transition:
    transform 160ms var(--lj-ease),
    opacity 160ms var(--lj-ease);
}

.pm-bgs-player-enter-from,
.pm-bgs-player-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

@media (max-width: 560px) {
  .pm-bgs__main {
    grid-template-columns: 148px minmax(0, 1fr);
  }
}
</style>
