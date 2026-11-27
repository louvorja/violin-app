<template>
  <div class="pm-bgp" data-testid="pm-library-background-projection">
    <div class="pm-bgp__main">
      <aside class="pm-bgp__side" :aria-label="tm('library.background_projection_categories')">
        <div class="pm-bgp__search">
          <LjInput
            v-model="search"
            size="sm"
            :icon="ICONS.ACTIONS.SEARCH"
            :placeholder="t('components.ui.search_placeholder')"
            clearable
            data-testid="pm-bgp-search"
          />
        </div>
        <div
          class="pm-bgp__chips"
          role="group"
          :aria-label="tm('library.background_projection_categories')"
        >
          <CategoryListItem
            category-id="*"
            :name="tm('library.all')"
            :icon="ICONS.MODULES.BACKGROUND_PROJECTION"
            icon-type="icon"
            color="var(--lj-orange)"
            :count="bgp.records.value.length"
            :active="bgp.filter.value === BACKGROUND_PROJECTION_ALL"
            @select="bgp.filter.value = BACKGROUND_PROJECTION_ALL"
          />
          <CategoryListItem
            v-for="category in bgp.categories.value"
            :key="category.id"
            :category-id="category.id"
            :name="category.name"
            :icon="chipIcon(category)"
            :icon-type="chipIconType(category)"
            :color="category.color || 'var(--lj-orange)'"
            :count="bgp.countOf(category.id)"
            :active="bgp.filter.value === category.id"
            @select="bgp.filter.value = category.id"
          />
          <CategoryListItem
            v-if="bgp.hasUncategorized.value"
            category-id=""
            :name="tm('library.background_projection_uncategorized')"
            :icon="ICONS.CATEGORY.FOLDER"
            icon-type="icon"
            color="var(--lj-orange)"
            :count="bgp.countOf(BACKGROUND_PROJECTION_UNCATEGORIZED)"
            :active="bgp.filter.value === BACKGROUND_PROJECTION_UNCATEGORIZED"
            @select="bgp.filter.value = BACKGROUND_PROJECTION_UNCATEGORIZED"
          />
        </div>
      </aside>

      <div class="pm-bgp__content">
        <div class="pm-bgp__toolbar">
          <LjTabs
            :model-value="mediaFilter"
            :tabs="mediaTabs"
            :aria-label="tm('library.background_projection')"
            @update:model-value="mediaFilter = $event as MediaFilter"
          />
        </div>

        <div class="pm-bgp__body">
          <p v-if="bgp.loading.value && !bgp.loaded.value" class="pm-bgp__empty">
            {{ tm("library.loading") }}
          </p>
          <LjEmpty
            v-else-if="!bgp.records.value.length"
            :icon="ICONS.MEDIA.IMAGE_MULTIPLE"
            :title="tm('library.background_projection_empty')"
          />
          <p v-else-if="!visibleCards.length" class="pm-bgp__empty">
            {{ tm("library.background_projection_no_results") }}
          </p>
          <div v-else class="pm-bgp__grid">
            <LjContextMenu
              v-for="card in visibleCards"
              :key="card.file.id"
              v-bind="menuFor(card.file)"
            >
              <div
                class="pm-bgp__card"
                :class="{ 'pm-bgp__card--active': isActive(card.file.id) }"
                :style="{ '--pm-bgp-card-color': card.color }"
                role="button"
                tabindex="0"
                :data-testid="`pm-bgp-card-${card.file.id}`"
                :title="bgp.displayName(card.file)"
                :aria-label="bgp.displayName(card.file)"
                @click="activate(card.file)"
                @keydown.enter.prevent="activate(card.file)"
                @keydown.space.prevent="activate(card.file)"
              >
                <span class="pm-bgp__thumb">
                  <img
                    v-if="card.thumb"
                    :src="card.thumb"
                    class="pm-bgp__thumb-img"
                    :alt="bgp.displayName(card.file)"
                    loading="lazy"
                  />
                  <LjIcon
                    v-else
                    :icon="card.file.type === 'video' ? ICONS.MEDIA.VIDEO_FILE : ICONS.MEDIA.IMAGE"
                    :size="28"
                  />
                  <span v-if="card.file.type === 'video'" class="pm-bgp__play-badge">
                    <LjIcon :icon="ICONS.PLAYER.PLAY" :size="13" />
                  </span>
                  <span v-if="isActive(card.file.id)" class="pm-bgp__live">
                    {{ tm("library.background_projection_live") }}
                  </span>
                </span>
                <span class="pm-bgp__info">
                  <span class="pm-bgp__name">{{ bgp.displayName(card.file) }}</span>
                  <span class="pm-bgp__category">
                    <img
                      v-if="card.iconType === 'image'"
                      :src="card.icon"
                      class="pm-bgp__category-icon"
                      alt=""
                    />
                    <LjIcon
                      v-else
                      :icon="card.icon"
                      :size="12"
                      :style="{ color: card.color }"
                      class="pm-bgp__category-icon"
                    />
                    <span class="pm-bgp__category-name">{{ card.categoryName }}</span>
                  </span>
                </span>
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.ADD"
                  :title="tm('library.add_to_program')"
                  :aria-label="tm('library.add_to_program')"
                  :data-testid="`pm-bgp-add-${card.file.id}`"
                  @click.stop="add(card.file)"
                  @keydown.stop
                />
              </div>
            </LjContextMenu>
          </div>
        </div>

        <footer class="pm-bgp__foot">
          <LjIcon :icon="ICONS.MODULES.BACKGROUND_PROJECTION" :size="12" />
          <span>{{ countLabel }}</span>
          <span class="pm-bgp__spacer" />
          <LjButton
            size="sm"
            variant="ghost"
            :icon="ICONS.UI.OPEN_IN_NEW"
            :title="tm('library.background_projection_manage')"
            data-testid="pm-bgp-manage"
            @click="openModule"
          >
            {{ tm("library.background_projection_manage") }}
          </LjButton>
        </footer>
      </div>
    </div>

    <Transition name="pm-bgp-bar">
      <div v-if="isProjectionOpen" class="pm-bgp__bar" data-testid="pm-bgp-bar">
        <span class="pm-bgp__bar-thumb">
          <img v-if="activeThumb" :src="activeThumb" alt="" />
          <LjIcon
            v-else
            :icon="
              activeRecord?.type === 'video' ? ICONS.MEDIA.VIDEO_FILE : ICONS.MEDIA.IMAGE_MULTIPLE
            "
            :size="20"
          />
        </span>
        <span class="pm-bgp__bar-info">
          <span class="pm-bgp__bar-name">
            {{
              activeRecord
                ? bgp.displayName(activeRecord)
                : tm("library.background_projection_none")
            }}
          </span>
          <span v-if="activeCategoryName" class="pm-bgp__bar-category">
            {{ activeCategoryName }}
          </span>
        </span>
        <LjButton size="sm" variant="ghost" data-testid="pm-bgp-clear" @click="clearProjection">
          {{ tm("library.background_projection_clear") }}
        </LjButton>
        <LjButton
          size="sm"
          variant="danger"
          :icon="ICONS.PROJECTION.STOP"
          data-testid="pm-bgp-stop"
          @click="stopProjection"
        >
          {{ tm("library.background_projection_stop") }}
        </LjButton>
      </div>
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
  LjTabs,
  type LjMenuItem,
  type LjTab,
} from "@/components/ui";
import CategoryListItem from "./CategoryListItem.vue";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import Modules from "@/helpers/Modules";
import $snackbar from "@/helpers/Snackbar";
import Strings from "@/helpers/Strings";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useModuleI18n } from "@/composables/useModuleI18n";
import {
  activateBackgroundProjection,
  clearBackgroundProjection,
  stopBackgroundProjection,
} from "@/helpers/BackgroundProjectionPlayback";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import {
  BackgroundPresentationGate,
  readStoredBackgroundState,
} from "@/presentation/BackgroundPresentationState";
import type { ProgramItem } from "@/types/Presentation";
import { backgroundProjectionItem } from "../program/items";
import {
  BACKGROUND_PROJECTION_ALL,
  BACKGROUND_PROJECTION_UNCATEGORIZED,
  useBackgroundProjectionLibrary,
  type BackgroundProjectionCategory,
  type BackgroundProjectionFile,
} from "../composables/useBackgroundProjectionLibrary";

/**
 * Aba Projeção de fundo da biblioteca. O clique ativa a mídia no telão de
 * fundo — o mesmo caminho da Liturgia e do módulo — e o `+` acrescenta ao
 * programa como um item `BG_PROJECTION`.
 */

interface ProjectionCard {
  file: BackgroundProjectionFile;
  color: string;
  icon: string;
  iconType: "icon" | "image";
  categoryName: string;
  thumb: string;
}

type MediaFilter = "all" | "image" | "video";

const emit = defineEmits<{ add: [item: ProgramItem] }>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const bgp = useBackgroundProjectionLibrary();
const search = ref("");
const mediaFilter = ref<MediaFilter>("all");
const isProjectionOpen = computed(
  () => $userdata.get<boolean>(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, false) === true
);
const activeId = ref<string | null>(null);
const backgroundGate = new BackgroundPresentationGate();

/** O `id` persiste no cache da projeção; reabrir a aba mantém o card destacado. */
function readActiveId(): string | null {
  try {
    const stored = localStorage.getItem(KEYS.PROJECTION.LJ_BACKGROUND_PROJECTION);
    if (!stored) return null;
    const state = readStoredBackgroundState(JSON.parse(stored));
    return state?.active && typeof state.id === "string" ? state.id : null;
  } catch {
    return null;
  }
}

useBroadcastListener(BROADCAST_TYPE.BACKGROUND_PROJECTION, (payload) => {
  // Mesmo portão da janela de projeção: pacote atrasado/duplicado não troca o
  // card destacado por uma mídia que já saiu do ar.
  const state = backgroundGate.accept(payload);
  if (!state) return;
  activeId.value = state.active && typeof state.id === "string" ? state.id : null;
});

const activeRecord = computed(
  () => bgp.records.value.find((file) => file.id === activeId.value) ?? null
);
const activeThumb = computed(() => (activeRecord.value ? bgp.thumbOf(activeRecord.value) : ""));
const activeCategoryName = computed(() =>
  activeRecord.value ? categoryOf(activeRecord.value)?.name || "" : ""
);

const mediaTabs = computed<LjTab[]>(() => [
  { value: "all", label: tm("library.all") },
  { value: "image", label: tm("library.background_projection_images") },
  { value: "video", label: tm("library.background_projection_videos") },
]);

const visible = computed(() => {
  let list = bgp.filtered.value;
  if (mediaFilter.value !== "all") list = list.filter((file) => file.type === mediaFilter.value);
  const query = Strings.fold(search.value.trim());
  if (query) {
    list = list.filter((file) => Strings.fold(bgp.displayName(file)).includes(query));
  }
  return list;
});

const visibleCards = computed<ProjectionCard[]>(() =>
  visible.value.map((file) => {
    const category = bgp.categoryOf(file);
    return {
      file,
      color: category?.color || "#607d8b",
      icon: category ? chipIcon(category) : ICONS.MEDIA.IMAGE_MULTIPLE,
      iconType: category ? chipIconType(category) : "icon",
      categoryName: category?.name || tm("library.background_projection_uncategorized"),
      thumb: bgp.thumbOf(file),
    };
  })
);

const countLabel = computed(() =>
  t(
    `modules.${ModuleEnum.PRESENTATION_MODE}.library.background_projection_count`,
    visible.value.length
  )
);

function categoryOf(file: BackgroundProjectionFile): BackgroundProjectionCategory | null {
  return bgp.categoryOf(file);
}

function chipIcon(category: BackgroundProjectionCategory): string {
  const image = bgp.categoryImageOf(category);
  if (image) return image;
  return category.iconType === "image"
    ? ICONS.MEDIA.IMAGE
    : category.icon || ICONS.MEDIA.IMAGE_MULTIPLE;
}

function chipIconType(category: BackgroundProjectionCategory): "icon" | "image" {
  return bgp.categoryImageOf(category) ? "image" : "icon";
}

function isActive(id: string): boolean {
  return isProjectionOpen.value && activeId.value === id;
}

async function activate(file: BackgroundProjectionFile): Promise<void> {
  try {
    const ok = await activateBackgroundProjection(file);
    if (!ok) $snackbar.error(tm("library.background_projection_unplayable"));
  } catch {
    $snackbar.error(tm("library.background_projection_unplayable"));
  }
}

function menuFor(file: BackgroundProjectionFile): {
  quick: LjMenuItem[];
  items: LjMenuItem[];
} {
  const active = isActive(file.id);
  return {
    quick: [
      {
        label: active
          ? tm("library.background_projection_stop")
          : tm("library.background_projection_activate"),
        icon: active ? ICONS.PROJECTION.STOP : ICONS.PLAYER.PLAY,
        action: () => void (active ? stopProjection() : activate(file)),
      },
      {
        label: tm("library.add_to_program"),
        icon: ICONS.ACTIONS.ADD,
        action: () => add(file),
      },
    ],
    items: [
      ...(active
        ? [
            {
              label: tm("library.background_projection_clear"),
              icon: ICONS.PROJECTION.CLEAN,
              action: clearProjection,
            },
          ]
        : isProjectionOpen.value
          ? [
              {
                label: tm("library.background_projection_stop"),
                icon: ICONS.PROJECTION.STOP,
                action: () => void stopProjection(),
              },
            ]
          : []),
      { separator: true },
      {
        label: tm("library.background_projection_manage"),
        icon: ICONS.UI.OPEN_IN_NEW,
        action: openModule,
      },
    ],
  };
}

function add(file: BackgroundProjectionFile): void {
  emit(
    "add",
    backgroundProjectionItem(
      { id: file.id, name: bgp.displayName(file), type: file.type },
      bgp.categoryOf(file)?.name
    )
  );
}

async function stopProjection(): Promise<void> {
  activeId.value = null;
  try {
    await stopBackgroundProjection();
  } catch {
    $snackbar.error(tm("library.background_projection_stop_failed"));
  }
}

function clearProjection(): void {
  activeId.value = null;
  clearBackgroundProjection();
}

function openModule(): void {
  Modules.open(ModuleEnum.BACKGROUND_PROJECTION);
}

onMounted(() => {
  activeId.value = readActiveId();
  void bgp.load();
});
onActivated(() => {
  activeId.value = readActiveId();
  if (bgp.loaded.value) void bgp.load();
});
onBeforeUnmount(() => bgp.disposeThumbs());
</script>

<style scoped>
.pm-bgp {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pm-bgp__main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
}

.pm-bgp__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--lj-surface-border);
}

.pm-bgp__search {
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-3) 0;
}

.pm-bgp__search :deep(.lj-input) {
  width: 100%;
  min-width: 0;
}

.pm-bgp__chips {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: var(--lj-space-2) 0;
  scrollbar-width: none;
}

.pm-bgp__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pm-bgp__toolbar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: var(--lj-space-1) var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-bgp__body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--lj-space-3) var(--lj-space-4);
}

.pm-bgp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--lj-space-2);
  align-content: start;
}

.pm-bgp__card {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-width: 0;
  padding: var(--lj-space-2) var(--lj-space-3);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-md);
  background: color-mix(in srgb, var(--pm-bgp-card-color) 8%, var(--lj-surface-bg-soft));
  color: var(--lj-text);
  cursor: pointer;
}

.pm-bgp__card:hover,
.pm-bgp__card:focus-visible {
  background: color-mix(in srgb, var(--pm-bgp-card-color) 14%, var(--lj-surface-bg-soft));
}

.pm-bgp__card--active {
  border-color: var(--lj-orange);
}

.pm-bgp__thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 38px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg);
  color: var(--lj-text-subtle);
}

.pm-bgp__thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pm-bgp__live {
  position: absolute;
  top: 2px;
  left: 2px;
  padding: 0 4px;
  border-radius: var(--lj-radius-xs);
  background: var(--lj-orange);
  color: var(--lj-white);
  font-size: 8px;
  line-height: 13px;
  font-weight: var(--lj-weight-semibold);
}

.pm-bgp__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.pm-bgp__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-sm);
}

.pm-bgp__category {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--lj-text-subtle);
  font-size: 10px;
}

.pm-bgp__category-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  object-fit: contain;
}

.pm-bgp__category-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pm-bgp__empty {
  margin: 0;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.pm-bgp__foot {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-2) var(--lj-space-4);
  border-top: 1px solid var(--lj-surface-border);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.pm-bgp__spacer {
  flex: 1;
}

.pm-bgp__bar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-height: 44px;
  padding: var(--lj-space-2) var(--lj-space-4);
  border-top: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
}

.pm-bgp__bar-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 30px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg);
  color: var(--lj-text-subtle);
}

.pm-bgp__bar-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pm-bgp__bar-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.pm-bgp__bar-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-sm);
}

.pm-bgp__bar-category {
  color: var(--lj-text-subtle);
  font-size: 10px;
}

.pm-bgp-bar-enter-active,
.pm-bgp-bar-leave-active {
  transition:
    transform 160ms var(--lj-ease),
    opacity 160ms var(--lj-ease);
}

.pm-bgp-bar-enter-from,
.pm-bgp-bar-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

@media (max-width: 560px) {
  .pm-bgp__main {
    grid-template-columns: 148px minmax(0, 1fr);
  }

  .pm-bgp__bar {
    flex-wrap: wrap;
  }
}
</style>
