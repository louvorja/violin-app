<template>
  <LjDialog
    :model-value="modelValue"
    :title="t('music_search.title')"
    :icon="ICONS.ACTIONS.SEARCH"
    size="lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <LjField layout="column" :label="t('music_search.find_label')">
      <LjInput
        ref="inputEl"
        v-model="query"
        autocomplete="off"
        @keydown.enter.prevent="selectFirstMatch"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
      />
    </LjField>

    <div class="lms-table-wrap">
      <table class="lms-table">
        <thead>
          <tr>
            <th class="lms-col-album">{{ t("music_search.col_album") }}</th>
            <th class="lms-col-music">{{ t("music_search.col_music") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filteredRows.length">
            <td colspan="2" class="lms-empty">
              {{ query ? t("music_search.empty_search") : t("music_search.empty") }}
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
            <td>{{ row.album }}</td>
            <td>{{ row.name }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <span class="lms-count">{{ filteredRows.length }} / {{ allRows.length }}</span>
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
import pt from "../lang/pt.json";
import es from "../lang/es.json";
import { LjButton, LjDialog, LjField, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import type { LiturgyMusicItem } from "@/types/Liturgy";

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

interface Row {
  id: number | string;
  name: string;
  album: string;
  raw: LiturgyMusicItem;
}

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    musicsList?: LiturgyMusicItem[];
  }>(),
  {
    modelValue: false,
    musicsList: () => [],
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [music: LiturgyMusicItem];
}>();

const { locale } = useI18n();
const t = (key: string) => _t(key, locale.value);

const query = ref("");
const activeIndex = ref(0);
const inputEl = ref<{ focus: () => void } | null>(null);

const allRows = computed<Row[]>(() => {
  const list = props.musicsList ?? [];
  const rows: Row[] = [];
  for (const m of list) {
    const albums = (m as { albums?: Array<{ name?: string }> }).albums;
    if (Array.isArray(albums) && albums.length) {
      for (const a of albums) {
        rows.push({ id: m.id_music, name: m.name, album: a?.name ?? "", raw: m });
      }
    } else {
      rows.push({ id: m.id_music, name: m.name, album: "", raw: m });
    }
  }
  rows.sort((a, b) => {
    const al = a.album.localeCompare(b.album, undefined, { sensitivity: "base" });
    if (al !== 0) return al;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return rows;
});

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
    (r) => normalize(r.name).includes(q) || normalize(r.album).includes(q)
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
  emit("pick", row.raw);
  emit("update:modelValue", false);
}
</script>

<!-- O corpo do diálogo viaja num portal, mas é compilado AQUI (slot do
     consumidor), então o Vue carimba o atributo de escopo nele e `scoped`
     funciona normalmente. -->
<style scoped>
/* Tabela não tem primitivo equivalente no catálogo: markup nativo sobre os
   tokens, com cabeçalho fixo enquanto a lista rola. */
.lms-table-wrap {
  max-height: 50vh;
  overflow-y: auto;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}
.lms-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--lj-text-base);
}
.lms-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--lj-surface-bg-soft);
  text-align: left;
  padding: var(--lj-space-4) var(--lj-space-5);
  font-weight: var(--lj-weight-medium);
  border-bottom: 1px solid var(--lj-surface-border);
}
.lms-table tbody td {
  padding: var(--lj-space-3) var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-divider);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lms-table tbody tr:hover,
.lms-table tbody tr.is-active {
  background: var(--lj-ui-accent-soft);
}
.lms-col-album {
  width: 38%;
}
.lms-empty {
  text-align: center;
  padding: var(--lj-space-8) var(--lj-space-5);
  color: var(--lj-text-subtle);
  cursor: default;
}

.lms-count {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}
</style>
