<template>
  <LjDialog
    :model-value="modelValue"
    :title="title"
    :icon="icon"
    size="lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <LjField layout="column" :label="t('library_search.find_label')">
      <LjInput
        ref="inputEl"
        v-model="query"
        autocomplete="off"
        @keydown.enter.prevent="selectFirstMatch"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
      />
    </LjField>

    <div class="lls-table-wrap">
      <table class="lls-table">
        <thead>
          <tr>
            <th class="lls-col-icon" />
            <th>{{ t("library_search.col_name") }}</th>
            <th v-if="showDetail" class="lls-col-detail">{{ t("library_search.col_detail") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filteredRows.length">
            <td :colspan="showDetail ? 3 : 2" class="lls-empty">
              {{ query ? t("library_search.empty_search") : t("library_search.empty") }}
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
            <td class="lls-icon-cell">
              <Icon :icon="row.icon" :size="16" />
            </td>
            <td>{{ row.name }}</td>
            <td v-if="showDetail" class="lls-detail-cell">{{ row.detail }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <span class="lls-count">{{ filteredRows.length }} / {{ allRows.length }}</span>
      <span class="lj-u-spacer" />
      <LjButton size="sm" @click="$emit('update:modelValue', false)">
        {{ t("actions.cancel") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
/**
 * LiturgyLibrarySearch — busca genérica reutilizável na Liturgia para
 * selecionar itens de bibliotecas locais (Biblioteca de Mídia, Som de
 * fundo, …). Filtro sem acentos + navegação por teclado, no padrão dos
 * demais dialogs de busca do módulo.
 */
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

export interface LibrarySearchItem {
  id: string;
  name: string;
  icon?: string;
  /** Texto opcional da coluna extra (tipo, duração…). */
  detail?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    items?: LibrarySearchItem[];
    title?: string;
    icon?: string;
    showDetail?: boolean;
  }>(),
  {
    modelValue: false,
    items: () => [],
    title: "",
    icon: ICONS.ACTIONS.SEARCH,
    showDetail: false,
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [item: LibrarySearchItem];
}>();

const { locale } = useI18n();
function t(key: string): string {
  return _t(key, locale.value);
}

const query = ref("");
const activeIndex = ref(0);
const inputEl = ref<{ focus: () => void } | null>(null);

const allRows = computed(() => props.items ?? []);

const filteredRows = computed(() => {
  const norm = (s: string): string =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const q = norm(query.value);
  if (!q) return allRows.value;
  const detail = props.showDetail;
  return allRows.value.filter(
    (r) => norm(r.name).includes(q) || (detail && r.detail ? norm(r.detail).includes(q) : false)
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

function moveSelection(delta: number): void {
  const max = filteredRows.value.length - 1;
  if (max < 0) return;
  activeIndex.value = Math.max(0, Math.min(max, activeIndex.value + delta));
}

function selectFirstMatch(): void {
  const row = filteredRows.value[activeIndex.value];
  if (row) selectRow(row);
}

function selectRow(row: LibrarySearchItem): void {
  emit("pick", row);
  emit("update:modelValue", false);
}
</script>

<!-- O corpo do diálogo viaja num portal, mas é compilado AQUI (slot do
     consumidor), então o Vue carimba o atributo de escopo nele e `scoped`
     funciona normalmente. -->
<style scoped>
/* Tabela não tem primitivo equivalente no catálogo: markup nativo sobre os
   tokens, com cabeçalho fixo enquanto a lista rola. */
.lls-table-wrap {
  max-height: 50vh;
  overflow-y: auto;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}
.lls-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--lj-text-base);
}
.lls-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--lj-surface-bg-soft);
  text-align: left;
  padding: var(--lj-space-4) var(--lj-space-5);
  font-weight: var(--lj-weight-medium);
  border-bottom: 1px solid var(--lj-surface-border);
}
.lls-table tbody td {
  padding: var(--lj-space-3) var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-divider);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lls-table tbody tr:hover,
.lls-table tbody tr.is-active {
  background: var(--lj-ui-accent-soft);
}
.lls-col-icon {
  width: 34px;
}
.lls-icon-cell {
  line-height: 0;
}
.lls-col-detail {
  width: 28%;
}
.lls-detail-cell {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
}
.lls-empty {
  text-align: center;
  padding: var(--lj-space-8) var(--lj-space-5);
  color: var(--lj-text-subtle);
  cursor: default;
}

.lls-count {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}
</style>
