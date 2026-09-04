<template>
  <LjDialog v-model="internalShow" :title="t('library.load_title')" size="md">
    <div class="llo-search">
      <LjInput
        v-model="search"
        class="llo-search__input"
        autofocus
        :icon="ICONS.ACTIONS.SEARCH"
        :placeholder="t('library.load_search')"
        :aria-label="t('library.load_search')"
      />
    </div>

    <div v-if="filtered.length" class="llo-list">
      <div v-for="item in filtered" :key="item.id" class="llo-item">
        <button type="button" class="llo-item__main" @click="doLoad(item)">
          <Icon
            :icon="ICONS.MODULES.LITURGY"
            :size="18"
            :color="item.color || DEFAULT_COLOR"
            class="llo-item__icon"
          />
          <span class="llo-item__text">
            <span class="llo-item__name">{{ item.name }}</span>
            <span v-if="item.updatedAt" class="llo-item__date">
              {{ formatDate(item.updatedAt) }}
            </span>
          </span>
        </button>

        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.COPY"
          :title="t('actions.clone')"
          :aria-label="t('actions.clone')"
          @click.stop="duplicateItem(item)"
        />
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          class="llo-btn-danger"
          :icon="ICONS.ACTIONS.DELETE"
          :title="t('actions.delete')"
          :aria-label="t('actions.delete')"
          @click.stop="deleteItem(item)"
        />
      </div>
    </div>

    <LjAlert
      v-else-if="!library.loading.value"
      class="llo-feedback"
      variant="info"
      :text="t('library.load_empty')"
    />

    <LjProgress v-if="library.loading.value" class="llo-feedback" indeterminate />
  </LjDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import pt from "../lang/pt.json";
import es from "../lang/es.json";
import Icon from "@/components/Icon.vue";
import { LjAlert, LjButton, LjDialog, LjInput, LjProgress } from "@/components/ui";
import $alert from "@/helpers/Alert";
import $liturgy from "@/helpers/Liturgy";
import { useLiturgyLibrary } from "../composables/useLiturgyLibrary";
import { DEFAULT_COLOR } from "../composables/useLiturgyItems";
import type { LiturgyItem } from "@/types/Liturgy";
import { ICONS } from "@/config/Icons";

const props = defineProps<{
  modelValue: boolean;
  items: LiturgyItem[];
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "loaded"): void;
}>();

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
const { locale } = useI18n();
const t = (key: string) => _t(key, locale.value);

const library = useLiturgyLibrary();
const internalShow = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    internalShow.value = v;
  }
);
watch(internalShow, (v) => emit("update:modelValue", v));

const search = ref("");
const allItems = ref<Awaited<ReturnType<typeof library.list>>>([]);

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  return q ? allItems.value?.filter((i) => i.name.toLowerCase().includes(q)) : allItems.value;
});

watch(internalShow, async (v) => {
  if (v) {
    search.value = "";
    allItems.value = await library.list();
  }
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString();
}

async function doLoad(item: Awaited<ReturnType<typeof library.list>>[number]) {
  const full = await library.get(item.id);
  if (!full) return;
  $alert.yesno(
    { title: t("library.load_title"), text: t("library.load_confirm") },
    (btn?: string) => {
      if (btn !== "yes") return;
      $liturgy.set(full.items, $liturgy.getActiveDay());
      $liturgy.setCurrentLiturgyId(full.id);
      internalShow.value = false;
      emit("loaded");
    }
  );
}

async function duplicateItem(item: Awaited<ReturnType<typeof library.list>>[number]) {
  const full = await library.get(item.id);
  if (!full) return;
  let name = `${t("library.duplicate_prefix")} ${full.name}`;
  let n = 1;
  while (await library.getByName(name)) {
    n++;
    name = `${t("library.duplicate_prefix_n").replace("{n}", String(n))} ${full.name}`;
  }
  const saved = await library.save({ name, items: full.items, color: full.color, binding: null });
  $alert.info({ text: t("library.duplicate_success").replace("{name}", saved.name) });
  allItems.value = await library.list();
}

async function deleteItem(item: Awaited<ReturnType<typeof library.list>>[number]) {
  $alert.yesno(
    { title: t("actions.delete"), text: t("library.delete_confirm").replace("{name}", item.name) },
    async (btn?: string) => {
      if (btn !== "yes") return;
      await library.remove(item.id);
      const current = $liturgy.getCurrentLiturgyId();
      if (current === item.id) $liturgy.setCurrentLiturgyId(null);
      allItems.value = await library.list();
    }
  );
}
</script>

<!-- O corpo do diálogo viaja num portal, mas é compilado AQUI (slot do
     consumidor), então o Vue carimba o atributo de escopo nele — inclusive na
     raiz dos primitivos filhos — e `scoped` funciona normalmente. -->
<style scoped>
/* O LjInput é inline-flex por padrão; o seletor descendente vence o do
   primitivo sem depender da ordem de injeção das folhas de estilo. */
.llo-search {
  margin-bottom: var(--lj-space-5);
}

.llo-search .llo-search__input {
  display: flex;
  width: 100%;
}

/* Lista sem primitivo equivalente no catálogo: moldura única com divisores,
   como a v-list que estava aqui. `overflow: hidden auto` mantém o recorte dos
   cantos arredondados enquanto a rolagem vertical continua. */
.llo-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: hidden auto;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.llo-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding-right: var(--lj-space-3);
}

.llo-item + .llo-item {
  border-top: 1px solid var(--lj-surface-divider);
}

.llo-item:hover {
  background: var(--lj-surface-bg-hover);
}

/* A linha inteira carrega a ação de carregar; os botões de duplicar e excluir
   ficam de fora dela porque botão dentro de botão é markup inválido. */
.llo-item__main {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-4) var(--lj-space-5);
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.llo-item__main:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.llo-item__icon {
  flex-shrink: 0;
}

.llo-item__text {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
}

.llo-item__name {
  overflow: hidden;
  color: var(--lj-text);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.llo-item__date {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}

/* Exclusão discreta: mantém o fantasma do LjButton e só troca a cor. O seletor
   descendente supera a regra `.lj-btn--ghost` do próprio primitivo. */
.llo-item .llo-btn-danger {
  color: var(--lj-danger);
}

.llo-item .llo-btn-danger:hover {
  background: var(--lj-danger-soft);
  color: var(--lj-danger);
}

.llo-feedback {
  margin-top: var(--lj-space-4);
}
</style>
