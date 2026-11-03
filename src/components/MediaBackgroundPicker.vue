<template>
  <LjDialog
    :model-value="modelValue"
    :title="t('components.customization.media_picker_title')"
    :icon="ICONS.MEDIA.LIBRARY"
    size="md"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <LjInput
      v-model="query"
      :icon="ICONS.ACTIONS.SEARCH"
      :placeholder="t('components.customization.media_picker_search')"
      clearable
    />

    <div class="mbp-toolbar">
      <button
        type="button"
        class="mbp-view"
        :class="{ 'mbp-view--active': viewMode === 'grid' }"
        :title="t('components.customization.media_picker_grid')"
        :aria-label="t('components.customization.media_picker_grid')"
        @click="viewMode = 'grid'"
      >
        <LjIcon :icon="ICONS.UI.VIEW_GRID" :size="16" />
      </button>
      <button
        type="button"
        class="mbp-view"
        :class="{ 'mbp-view--active': viewMode === 'list' }"
        :title="t('components.customization.media_picker_list')"
        :aria-label="t('components.customization.media_picker_list')"
        @click="viewMode = 'list'"
      >
        <LjIcon :icon="ICONS.UI.VIEW_LIST" :size="16" />
      </button>
    </div>

    <div v-if="loading" class="mbp-empty">{{ t("alert.wait") }}</div>
    <template v-else>
      <div v-for="group in groups" :key="group.id" class="mbp-group">
        <div class="mbp-group-title">{{ t(group.label) }}</div>
        <div v-if="!group.items.length" class="mbp-empty">
          {{ t("components.customization.media_picker_empty") }}
        </div>
        <div v-if="viewMode === 'grid'" class="mbp-grid">
          <button
            v-for="item in group.items"
            :key="`${item.source}-${item.id}`"
            type="button"
            class="mbp-thumb"
            :title="item.name"
            @click="pick(item)"
          >
            <span class="mbp-thumb-media">
              <img v-if="item.thumb" :src="item.thumb" :alt="item.name" loading="lazy" />
              <LjIcon
                v-else
                :icon="item.type === 'video' ? ICONS.MEDIA.VIDEO_FILE : ICONS.MEDIA.IMAGE"
                :size="28"
              />
              <span v-if="item.type === 'video'" class="mbp-thumb-play" aria-hidden="true">
                <LjIcon
                  :icon="item.type === 'video' ? ICONS.PLAYER.PLAY : ICONS.MEDIA.IMAGE"
                  :size="14"
                />
              </span>
            </span>
            <span class="mbp-thumb-name">{{ item.name }}</span>
          </button>
        </div>
        <template v-else>
          <button
            v-for="item in group.items"
            :key="`${item.source}-${item.id}`"
            type="button"
            class="mbp-item"
            :title="item.name"
            @click="pick(item)"
          >
            <span class="mbp-item-icon">
              <LjIcon
                :icon="item.type === 'video' ? ICONS.MEDIA.VIDEO_FILE : ICONS.MEDIA.IMAGE"
                :size="20"
              />
            </span>
            <span class="mbp-item-name">{{ item.name }}</span>
            <span class="mbp-item-type">
              {{
                t(
                  item.type === "video"
                    ? "components.customization.media_picker_video"
                    : "components.customization.media_picker_image"
                )
              }}
            </span>
          </button>
        </template>
      </div>
    </template>

    <template #footer>
      <LjButton size="sm" @click="$emit('update:modelValue', false)">
        {{ t("alert.cancel") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton, LjDialog, LjIcon, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { DB_TABLE } from "@/constants/DbTables";
import $idb from "@/helpers/IndexedDB";
import $path from "@/helpers/Path";
import Platform from "@/helpers/Platform";

interface LibraryRow {
  id: string;
  name: string;
  path?: string;
  type?: string;
  data?: ArrayBuffer;
  mime?: string;
  thumb?: string;
}

interface PickerItem {
  id: string;
  name: string;
  type: "image" | "video";
  source: "media" | "background";
  url: string;
  thumb: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    /** Tipos que o consumidor aceita; o fundo dos slides só aceita imagem. */
    mediaTypes?: ("image" | "video")[];
  }>(),
  { modelValue: false, mediaTypes: () => ["image", "video"] }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [item: { url: string; name: string; type: "image" | "video" }];
}>();

const { t } = useI18n();
const query = ref("");
const viewMode = ref<"grid" | "list">("grid");
const loading = ref(false);
const items = ref<PickerItem[]>([]);
const VIDEO_URL_RE = /\.(mp4|webm|mkv|mov|m4v|avi|ogv)(?:[?#]|$)/i;

function resolveUrl(row: LibraryRow, type: "image" | "video"): string {
  const raw = String(row.path || "");
  let url = raw;
  if (raw.startsWith("blob:") && row.data && row.mime) {
    // Blob URLs não sobrevivem a recarregar a página nem cruzam janelas; os
    // bytes no IndexedDB são a fonte confiável no web.
    url = URL.createObjectURL(new Blob([row.data], { type: row.mime }));
  } else if (raw && !/^(blob|data|https?|louvorja|file):/i.test(raw)) {
    url = Platform.isDesktop ? $path.local(raw) : raw;
  } else if (!url && row.data && row.mime) {
    url = URL.createObjectURL(new Blob([row.data], { type: row.mime }));
  }
  if (type === "video" && url && !VIDEO_URL_RE.test(url) && !/^data:video\//i.test(url)) {
    url += url.includes("#") ? "" : "#video";
  }
  return url;
}

function resolveThumb(raw: string | undefined, type: "image" | "video", url: string): string {
  const value = String(raw || "");
  if (!value) return type === "image" ? url : "";
  if (/^(blob|data|https?|louvorja|file):/i.test(value)) return value;
  return Platform.isDesktop ? $path.local(value) : value;
}

function normalize(row: LibraryRow, source: PickerItem["source"]): PickerItem | null {
  const type = row.type === "video" ? "video" : row.type === "image" ? "image" : null;
  if (!type || !props.mediaTypes.includes(type) || !row.id || !row.name) return null;
  const url = resolveUrl(row, type);
  if (!url) return null;
  return {
    id: row.id,
    name: row.name,
    type,
    source,
    url,
    thumb: resolveThumb(row.thumb, type, url),
  };
}

async function load(): Promise<void> {
  loading.value = true;
  query.value = "";
  viewMode.value = "grid";
  try {
    const [media, background] = await Promise.all([
      $idb.getAll<LibraryRow>(DB_TABLE.MEDIA_LIBRARY).catch(() => []),
      $idb.getAll<LibraryRow>(DB_TABLE.BACKGROUND_PROJECTION_LIBRARY).catch(() => []),
    ]);
    items.value = [
      ...media.map((row) => normalize(row, "media")).filter((x): x is PickerItem => !!x),
      ...background.map((row) => normalize(row, "background")).filter((x): x is PickerItem => !!x),
    ];
  } finally {
    loading.value = false;
  }
}

const filtered = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  if (!q) return items.value;
  return items.value.filter((item) => item.name.toLocaleLowerCase().includes(q));
});

const groups = computed(() => [
  {
    id: "media",
    label: "components.customization.media_picker_media",
    items: filtered.value.filter((item) => item.source === "media"),
  },
  {
    id: "background",
    label: "components.customization.media_picker_background",
    items: filtered.value.filter((item) => item.source === "background"),
  },
]);

function pick(item: PickerItem): void {
  emit("pick", { url: item.url, name: item.name, type: item.type });
  emit("update:modelValue", false);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load();
  },
  { immediate: true }
);
</script>

<style scoped>
.mbp-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin-top: var(--lj-space-2);
}
.mbp-view {
  width: 28px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--lj-radius-xs);
  background: transparent;
  color: var(--lj-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.mbp-view:hover,
.mbp-view--active {
  border-color: var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text);
}
.mbp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: var(--lj-space-3);
}
.mbp-thumb {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--lj-radius-sm);
  background: transparent;
  color: var(--lj-text);
  text-align: left;
  cursor: pointer;
}
.mbp-thumb:hover {
  border-color: var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
}
.mbp-thumb-media {
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
.mbp-thumb-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mbp-thumb-play {
  position: absolute;
  right: 4px;
  bottom: 4px;
  display: inline-flex;
  padding: 3px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.mbp-thumb-name {
  padding: 0 var(--lj-space-1);
  font-size: var(--lj-text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mbp-group {
  margin-top: var(--lj-space-4);
}
.mbp-group-title {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text-muted);
  margin-bottom: var(--lj-space-2);
}
.mbp-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  width: 100%;
  padding: var(--lj-space-2) var(--lj-space-3);
  border: 1px solid transparent;
  border-radius: var(--lj-radius-sm);
  background: transparent;
  color: var(--lj-text);
  text-align: left;
  cursor: pointer;
}
.mbp-item:hover {
  border-color: var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
}
.mbp-item-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--lj-text-muted);
}
.mbp-item-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mbp-item-type {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
}
.mbp-empty {
  padding: var(--lj-space-3);
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}
</style>
