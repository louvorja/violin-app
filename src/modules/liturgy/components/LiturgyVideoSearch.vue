<template>
  <LjDialog
    :model-value="modelValue"
    :title="t('video_search.title')"
    :icon="ICONS.MEDIA.YOUTUBE"
    size="lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="vls-toolbar">
      <LjInput
        ref="inputEl"
        v-model="query"
        :icon="ICONS.ACTIONS.SEARCH"
        :placeholder="t('video_search.find_label')"
        autocomplete="off"
        class="vls-search"
        @keydown="onKeydown"
      />
      <div class="vls-view-toggle" role="group" :aria-label="t('video_search.view')">
        <button
          type="button"
          class="vls-view"
          :class="{ 'vls-view--active': viewMode === 'thumbnails' }"
          :aria-pressed="viewMode === 'thumbnails'"
          :title="t('video_search.thumbnails')"
          @click="viewMode = 'thumbnails'"
        >
          <LjIcon :icon="ICONS.UI.VIEW_GRID" :size="16" />
        </button>
        <button
          type="button"
          class="vls-view"
          :class="{ 'vls-view--active': viewMode === 'list' }"
          :aria-pressed="viewMode === 'list'"
          :title="t('video_search.list')"
          @click="viewMode = 'list'"
        >
          <LjIcon :icon="ICONS.UI.VIEW_LIST" :size="16" />
        </button>
      </div>
    </div>

    <div v-if="programVideos.length" class="vls-chip-row">
      <span class="vls-chip-row-label">{{ t("video_search.channels") }}</span>
      <button
        type="button"
        class="vls-chip"
        :class="{ 'vls-chip--active': selectedChannel === null }"
        @click="selectedChannel = null"
      >
        {{ t("video_search.all_channels") }}
      </button>
      <button
        v-for="channel in channels"
        :key="channel.id"
        type="button"
        class="vls-chip"
        :class="{ 'vls-chip--active': selectedChannel === channel.id }"
        @click="selectedChannel = channel.id"
      >
        <img
          v-if="channel.icon"
          :src="channel.icon"
          alt=""
          class="vls-chip-image"
          draggable="false"
        />
        <LjIcon v-else :icon="ICONS.MEDIA.YOUTUBE" :size="13" />
        {{ channel.name }}
      </button>
    </div>

    <div v-if="customVideos.length" class="vls-chip-row">
      <span class="vls-chip-row-label">{{ t("video_search.categories") }}</span>
      <button
        type="button"
        class="vls-chip"
        :class="{ 'vls-chip--active': selectedCategory === null }"
        @click="selectedCategory = null"
      >
        {{ t("video_search.all_categories") }}
      </button>
      <button
        v-for="category in categories"
        :key="category.id"
        type="button"
        class="vls-chip"
        :class="{ 'vls-chip--active': selectedCategory === category.id }"
        @click="selectedCategory = category.id"
      >
        <LjIcon
          v-if="category.icon && category.iconType !== 'image'"
          :icon="category.icon"
          :size="13"
          :style="{ color: category.color }"
        />
        <img
          v-else-if="category.icon"
          :src="category.icon"
          alt=""
          class="vls-chip-image"
          draggable="false"
        />
        {{ category.name }}
      </button>
    </div>

    <div ref="viewport" class="vls-body">
      <div v-if="!flatItems.length" class="vls-empty">
        {{ query ? t("video_search.empty_search") : t("video_search.empty") }}
      </div>
      <template v-else>
        <section v-if="programGroups.length" class="vls-section">
          <h4 class="vls-section-title">{{ t("video_search.program_section") }}</h4>
          <LibraryGroupedView
            :groups="programGroups"
            :view="viewMode === 'thumbnails' ? 'grid' : 'list'"
          >
            <template #grid-item="{ item }">
              <button
                type="button"
                class="vls-card"
                :class="{
                  'vls-card--active': item.id === activeId,
                  'vls-card--selected': item.id === selectedId,
                }"
                :style="{ '--vls-item-color': colorOf(item) }"
                :data-video-active="item.id === activeId || undefined"
                :title="item.name"
                @click="pick(item)"
              >
                <span class="vls-card-thumb">
                  <img
                    v-if="item.thumbnail"
                    :src="item.thumbnail"
                    alt=""
                    loading="lazy"
                    draggable="false"
                  />
                  <LjIcon v-else :icon="ICONS.MEDIA.YOUTUBE" :size="28" />
                  <span v-if="item.typeLabel" class="vls-card-detail">{{ item.typeLabel }}</span>
                </span>
                <span class="vls-card-name">{{ item.name }}</span>
              </button>
            </template>
            <template #list-item="{ item }">
              <button
                type="button"
                class="vls-row"
                :class="{
                  'vls-row--active': item.id === activeId,
                  'vls-row--selected': item.id === selectedId,
                }"
                :style="{ '--vls-item-color': colorOf(item) }"
                :data-video-active="item.id === activeId || undefined"
                :title="item.name"
                @click="pick(item)"
              >
                <span class="vls-row-icon">
                  <img v-if="item.thumbnail" :src="item.thumbnail" alt="" draggable="false" />
                  <LjIcon v-else :icon="ICONS.MEDIA.YOUTUBE" :size="18" />
                </span>
                <span class="vls-row-name">{{ item.name }}</span>
                <span v-if="item.typeLabel" class="vls-row-detail">{{ item.typeLabel }}</span>
              </button>
            </template>
          </LibraryGroupedView>
        </section>

        <section v-if="customGroups.length" class="vls-section">
          <h4 class="vls-section-title">{{ t("video_search.custom_section") }}</h4>
          <LibraryGroupedView
            :groups="customGroups"
            :view="viewMode === 'thumbnails' ? 'grid' : 'list'"
          >
            <template #grid-item="{ item }">
              <button
                type="button"
                class="vls-card"
                :class="{
                  'vls-card--active': item.id === activeId,
                  'vls-card--selected': item.id === selectedId,
                }"
                :style="{ '--vls-item-color': colorOf(item) }"
                :data-video-active="item.id === activeId || undefined"
                :title="item.name"
                @click="pick(item)"
              >
                <span class="vls-card-thumb">
                  <img
                    v-if="item.thumbnail"
                    :src="item.thumbnail"
                    alt=""
                    loading="lazy"
                    draggable="false"
                  />
                  <LjIcon v-else :icon="ICONS.MODULES.CUSTOM_ONLINE_VIDEOS" :size="28" />
                  <span v-if="item.typeLabel" class="vls-card-detail">{{ item.typeLabel }}</span>
                </span>
                <span class="vls-card-name">{{ item.name }}</span>
              </button>
            </template>
            <template #list-item="{ item }">
              <button
                type="button"
                class="vls-row"
                :class="{
                  'vls-row--active': item.id === activeId,
                  'vls-row--selected': item.id === selectedId,
                }"
                :style="{ '--vls-item-color': colorOf(item) }"
                :data-video-active="item.id === activeId || undefined"
                :title="item.name"
                @click="pick(item)"
              >
                <span class="vls-row-icon">
                  <img v-if="item.thumbnail" :src="item.thumbnail" alt="" draggable="false" />
                  <LjIcon v-else :icon="ICONS.MODULES.CUSTOM_ONLINE_VIDEOS" :size="18" />
                </span>
                <span class="vls-row-name">{{ item.name }}</span>
                <span v-if="item.typeLabel" class="vls-row-detail">{{ item.typeLabel }}</span>
              </button>
            </template>
          </LibraryGroupedView>
        </section>
      </template>
    </div>

    <template #footer>
      <span class="vls-count">{{ flatItems.length }} / {{ videosList.length }}</span>
      <span class="lj-u-spacer" />
      <span class="vls-hint">{{ t("library_search.keyboard_hint") }}</span>
      <LjButton size="sm" @click="$emit('update:modelValue', false)">
        {{ t("actions.cancel") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { LjButton, LjDialog, LjIcon, LjInput } from "@/components/ui";
import LibraryGroupedView from "@/components/LibraryGroupedView.vue";
import { ICONS } from "@/config/Icons";
import { useListNavigation } from "@/composables/useListNavigation";
import { useLiturgyI18n } from "../i18n";
import { videoIdFromUrl } from "@/helpers/OnlineVideo";

export interface VideoSearchItem {
  id: string;
  name: string;
  url: string;
  source?: "custom" | "online";
  origin?: string;
  originIcon?: string;
  channelId?: string;
  channelName?: string;
  playlistId?: string;
  playlistName?: string;
  categoryId?: string;
  categoryName?: string;
  categoryIcon?: string;
  categoryIconType?: "icon" | "image";
  categoryColor?: string;
}

interface VideoGroupItem {
  id: string;
  name: string;
  video: VideoSearchItem;
  color: string;
  typeLabel: string;
  thumbnail: string;
}

interface VideoGroup {
  id: string;
  name: string;
  items: VideoGroupItem[];
}

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    videosList?: VideoSearchItem[];
    selectedUrl?: string;
  }>(),
  { modelValue: false, videosList: () => [], selectedUrl: "" }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [video: { id: string; name: string; url: string }];
}>();

const { t } = useLiturgyI18n();
const query = ref("");
const viewMode = ref<"thumbnails" | "list">("thumbnails");
const selectedChannel = ref<string | null>(null);
const selectedCategory = ref<string | null>(null);
const inputEl = ref<{ focus: () => void } | null>(null);
const viewport = ref<HTMLElement | null>(null);

const PALETTE = ["#e74c3c", "#1976d2", "#2e7d32", "#6a1b9a", "#ef6c00", "#00838f"];

function sourceOf(video: VideoSearchItem): "custom" | "online" {
  return video.source === "online" ? "online" : "custom";
}

function programGroupId(video: VideoSearchItem): string {
  return video.channelId || "__sem_canal__";
}

function programGroupName(video: VideoSearchItem): string {
  return video.channelName || t("video_search.without_channel");
}

function channelColor(video: VideoSearchItem): string {
  if (!video.channelId) return "#607d8b";
  let hash = 0;
  for (const char of video.channelId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

function customGroupId(video: VideoSearchItem): string {
  return video.categoryId ? `custom:${video.categoryId}` : "custom:__sem_categoria__";
}

function customGroupName(video: VideoSearchItem): string {
  return video.categoryName || t("video_search.uncategorized");
}

function customColor(video: VideoSearchItem): string {
  return video.categoryColor || "#607d8b";
}

const programVideos = computed(() =>
  (props.videosList ?? []).filter((v) => sourceOf(v) === "online")
);
const customVideos = computed(() =>
  (props.videosList ?? []).filter((v) => sourceOf(v) === "custom")
);

const channels = computed(() => {
  const map = new Map<string, { id: string; name: string; icon?: string }>();
  for (const video of programVideos.value) {
    const id = programGroupId(video);
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: programGroupName(video),
        icon: video.originIcon || undefined,
      });
    }
  }
  return [...map.values()];
});

const categories = computed(() => {
  const map = new Map<
    string,
    {
      id: string;
      name: string;
      icon?: string;
      iconType?: "icon" | "image";
      color?: string;
    }
  >();
  for (const video of customVideos.value) {
    const id = customGroupId(video);
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: customGroupName(video),
        icon: video.categoryIcon,
        iconType: video.categoryIconType,
        color: customColor(video),
      });
    }
  }
  if (customVideos.value.length && !map.has("custom:__sem_categoria__")) {
    map.set("custom:__sem_categoria__", {
      id: "custom:__sem_categoria__",
      name: t("video_search.uncategorized"),
      icon: ICONS.UI.FILE_MULTIPLE,
      iconType: "icon",
      color: "#607d8b",
    });
  }
  return [...map.values()];
});

function searchMatch(video: VideoSearchItem): boolean {
  const q = query.value.trim().toLocaleLowerCase();
  return !q || video.name.toLocaleLowerCase().includes(q);
}

function makeItem(video: VideoSearchItem, color: string): VideoGroupItem {
  const ytId = videoIdFromUrl(video.url);
  return {
    id: `${sourceOf(video)}:${video.id}`,
    name: video.name,
    video,
    color,
    typeLabel:
      sourceOf(video) === "online"
        ? video.playlistName || video.origin || t("video_search.source_online")
        : t("video_search.source_custom"),
    thumbnail: ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : video.originIcon || "",
  };
}

function groupVideos(
  videos: VideoSearchItem[],
  selected: string | null,
  groupId: (_video: VideoSearchItem) => string,
  groupName: (_video: VideoSearchItem) => string,
  color: (_video: VideoSearchItem) => string
): VideoGroup[] {
  const map = new Map<string, VideoGroup>();
  for (const video of videos) {
    if (!searchMatch(video)) continue;
    const id = groupId(video);
    if (selected !== null && selected !== id) continue;
    let group = map.get(id);
    if (!group) {
      group = { id, name: groupName(video), items: [] };
      map.set(id, group);
    }
    group.items.push(makeItem(video, color(video)));
  }
  return [...map.values()];
}

const programGroups = computed(() =>
  groupVideos(
    programVideos.value,
    selectedChannel.value,
    programGroupId,
    programGroupName,
    channelColor
  )
);

const customGroups = computed(() =>
  groupVideos(
    customVideos.value,
    selectedCategory.value,
    customGroupId,
    customGroupName,
    customColor
  )
);

const flatItems = computed(() => [
  ...programGroups.value.flatMap((group) => group.items),
  ...customGroups.value.flatMap((group) => group.items),
]);

const selectedId = computed(() => {
  if (!props.selectedUrl) return "";
  const found = flatItems.value.find((item) => item.video.url === props.selectedUrl);
  return found?.id || "";
});

function colorOf(item: VideoGroupItem): string {
  return item.color;
}

const nav = useListNavigation<VideoGroupItem>({
  items: () => flatItems.value,
  container: viewport,
  activeSelector: '[data-video-active="true"]',
  start: () =>
    Math.max(
      0,
      flatItems.value.findIndex((item) => item.id === selectedId.value)
    ),
});
const activeId = computed(() => nav.active.value?.id || "");

watch(flatItems, () => nav.reset());

function pick(item: VideoGroupItem): void {
  emit("pick", { id: item.video.id, name: item.video.name, url: item.video.url });
  emit("update:modelValue", false);
}

function selectActive(): void {
  const item = nav.active.value;
  if (item) pick(item);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    selectActive();
    return;
  }
  const grid = viewMode.value === "thumbnails";
  const delta =
    event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowUp"
        ? -1
        : grid && event.key === "ArrowRight"
          ? 1
          : grid && event.key === "ArrowLeft"
            ? -1
            : 0;
  if (!delta) return;
  event.preventDefault();
  nav.move(delta);
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    query.value = "";
    selectedChannel.value = null;
    selectedCategory.value = null;
    viewMode.value = "thumbnails";
    nav.reset();
    nextTick(() => inputEl.value?.focus());
  }
);
</script>

<style scoped>
.vls-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
}
.vls-search {
  flex: 1;
  min-width: 0;
}
.vls-view-toggle {
  display: inline-flex;
  gap: 2px;
}
.vls-view {
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--lj-radius-xs);
  background: transparent;
  color: var(--lj-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.vls-view:hover,
.vls-view--active {
  border-color: var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text);
}
.vls-chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-2);
  margin-top: var(--lj-space-3);
}
.vls-chip-row-label {
  width: 100%;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
}
.vls-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 240px;
  padding: 4px 9px;
  border: 1px solid var(--lj-surface-border);
  border-radius: 999px;
  background: transparent;
  color: var(--lj-text-muted);
  font: inherit;
  font-size: var(--lj-text-sm);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vls-chip:hover,
.vls-chip--active {
  border-color: var(--lj-navy);
  background: color-mix(in srgb, var(--lj-navy) 10%, transparent);
  color: var(--lj-text);
}
.vls-chip-image {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  object-fit: cover;
}
.vls-body {
  max-height: 54vh;
  overflow-y: auto;
  padding: 2px 2px 0 0;
}
.vls-section {
  margin-top: var(--lj-space-4);
}
.vls-section:first-of-type {
  margin-top: var(--lj-space-3);
}
.vls-section-title {
  margin: 0 0 var(--lj-space-2);
  color: var(--lj-text);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
}
.vls-body :deep(.lgv-items--grid) {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}
.vls-card,
.vls-row {
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--vls-item-color, transparent) 10%, transparent);
  color: var(--lj-text);
  font: inherit;
  cursor: pointer;
}
.vls-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 4px;
  border-radius: var(--lj-radius-sm);
  text-align: left;
}
.vls-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  width: 100%;
  padding: var(--lj-space-2) var(--lj-space-3);
  border-radius: var(--lj-radius-sm);
  text-align: left;
}
.vls-card:hover,
.vls-card--active,
.vls-row:hover,
.vls-row--active {
  border-color: var(--lj-surface-border);
  background: color-mix(
    in srgb,
    var(--vls-item-color, var(--lj-navy)) 18%,
    var(--lj-surface-bg-soft)
  );
}
.vls-card--selected,
.vls-row--selected {
  border-color: var(--lj-navy);
}
.vls-card-thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--lj-radius-xs);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text-muted);
}
.vls-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.vls-card-detail {
  position: absolute;
  right: 4px;
  bottom: 4px;
  max-width: calc(100% - 8px);
  padding: 1px 4px;
  border-radius: var(--lj-radius-xs);
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vls-card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--lj-text-xs);
}
.vls-row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 28px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-muted);
}
.vls-row-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.vls-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vls-row-detail {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}
.vls-empty {
  padding: var(--lj-space-5);
  text-align: center;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}
.vls-count {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
}
.vls-hint {
  margin-right: var(--lj-space-3);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
}
@media (max-width: 640px) {
  .vls-hint {
    display: none;
  }
}
</style>
