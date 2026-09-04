<template>
  <LjDialog
    :model-value="modelValue"
    :title="t('video_search.title')"
    :icon="ICONS.ACTIONS.SEARCH"
    size="lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <LjField layout="column" :label="t('video_search.find_label')">
      <LjInput
        ref="inputEl"
        v-model="query"
        autocomplete="off"
        @keydown.enter.prevent="selectFirstMatch"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
      />
    </LjField>

    <div class="lvs-table-wrap">
      <table class="lvs-table">
        <thead>
          <tr>
            <th class="lvs-col-source">{{ t("video_search.col_source") }}</th>
            <th class="lvs-col-video">{{ t("video_search.col_video") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filteredRows.length">
            <td colspan="2" class="lvs-empty">
              {{ query ? t("video_search.empty_search") : t("video_search.empty") }}
            </td>
          </tr>
          <tr
            v-for="(row, i) in filteredRows"
            :key="`${row.id}-${i}`"
            :class="{ 'is-active': i === activeIndex }"
            @mouseenter="activeIndex = i"
            @click="selectRow(row)"
            @dblclick="selectRow(row)"
          >
            <td class="lvs-source-cell">
              <img
                v-if="row.source === 'online' && row.iconUrl && !failedIcons.has(row.id)"
                :src="row.iconUrl"
                alt=""
                class="lvs-source-img"
                loading="lazy"
                @error="failedIcons.add(row.id)"
              />
              <Icon
                v-else-if="row.source === 'online'"
                :icon="ICONS.MODULES.ONLINE_VIDEOS"
                :size="13"
                class="lvs-source-icon"
              />
              <Icon
                v-else
                :icon="ICONS.MODULES.CUSTOM_ONLINE_VIDEOS"
                :size="13"
                class="lvs-source-icon"
              />
              {{ row.sourceLabel }}
            </td>
            <td>{{ row.name }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <span class="lvs-count">{{ filteredRows.length }} / {{ allRows.length }}</span>
      <span class="lj-u-spacer" />
      <LjButton size="sm" @click="$emit('update:modelValue', false)">
        {{ t("actions.cancel") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { LjButton, LjDialog, LjField, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import pt from "../lang/pt.json";
import es from "../lang/es.json";

const TRANSLATIONS: Record<string, Record<string, unknown>> = { pt, es };

function _t(key: string, locale: string): string {
  const dict = TRANSLATIONS[locale] ?? TRANSLATIONS.pt;
  const path = key.split(".");
  let cur: unknown = dict;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in cur) cur = (cur as Record<string, unknown>)[k];
    else return key;
  }
  return typeof cur === "string" ? cur : key;
}

export interface VideoSearchItem {
  id: string;
  name: string;
  url: string;
  source?: "custom" | "online";
  origin?: string;
  originIcon?: string;
}

interface Row {
  id: string;
  name: string;
  url: string;
  source: "custom" | "online";
  sourceLabel: string;
  iconUrl: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    videosList?: VideoSearchItem[];
  }>(),
  {
    modelValue: false,
    videosList: () => [],
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [video: { id: string; name: string; url: string }];
}>();

const { locale } = useI18n();
const t = (key: string) => _t(key, locale.value);

const query = ref("");
const activeIndex = ref(0);
const inputEl = ref<{ focus: () => void } | null>(null);
const failedIcons = ref(new Set<string>());

function sourceLabel(v: VideoSearchItem): string {
  if (v.source === "online") return v.origin || t("video_search.source_online");
  return v.source === "custom" || !v.source
    ? t("video_search.source_custom")
    : t("video_search.source_online");
}

const allRows = computed<Row[]>(() =>
  (props.videosList ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    url: v.url,
    source: v.source === "online" ? "online" : "custom",
    sourceLabel: sourceLabel(v),
    iconUrl: v.originIcon || "",
  }))
);

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const filteredRows = computed<Row[]>(() => {
  const q = normalize(query.value);
  if (!q) return allRows.value;
  return allRows.value.filter(
    (r) => normalize(r.name).includes(q) || normalize(r.sourceLabel).includes(q)
  );
});

watch(filteredRows, () => {
  activeIndex.value = 0;
});

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      query.value = "";
      activeIndex.value = 0;
      // O campo só existe depois que o diálogo monta o conteúdo; o nextTick
      // roda depois do autofoco do próprio diálogo, então o foco fica aqui.
      nextTick(() => inputEl.value?.focus());
    }
  }
);

function moveSelection(delta: number) {
  const max = filteredRows.value.length - 1;
  if (max < 0) return;
  activeIndex.value = Math.max(0, Math.min(max, activeIndex.value + delta));
}

function selectFirstMatch() {
  const row = filteredRows.value[activeIndex.value];
  if (row) selectRow(row);
}

function selectRow(row: Row) {
  emit("pick", { id: row.id, name: row.name, url: row.url });
  emit("update:modelValue", false);
}
</script>

<!-- O corpo do diálogo viaja num portal, mas é compilado AQUI (slot do
     consumidor), então o Vue carimba o atributo de escopo nele e `scoped`
     funciona normalmente. -->
<style scoped>
/* Tabela não tem primitivo equivalente no catálogo: markup nativo sobre os
   tokens, com cabeçalho fixo enquanto a lista rola. */
.lvs-table-wrap {
  max-height: 50vh;
  overflow-y: auto;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}
.lvs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--lj-text-base);
}
.lvs-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--lj-surface-bg-soft);
  text-align: left;
  padding: var(--lj-space-4) var(--lj-space-5);
  font-weight: var(--lj-weight-medium);
  border-bottom: 1px solid var(--lj-surface-border);
}
.lvs-table tbody td {
  padding: var(--lj-space-3) var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-divider);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lvs-table tbody tr:hover,
.lvs-table tbody tr.is-active {
  background: var(--lj-ui-accent-soft);
}
.lvs-col-source {
  width: 32%;
}
.lvs-source-cell {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
}
.lvs-source-icon {
  vertical-align: -2px;
  margin-right: var(--lj-space-1);
}
.lvs-source-img {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  object-fit: cover;
  vertical-align: -3px;
  margin-right: 3px;
}
.lvs-empty {
  text-align: center;
  padding: var(--lj-space-8) var(--lj-space-5);
  color: var(--lj-text-subtle);
  cursor: default;
}

.lvs-count {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}
</style>
