<template>
  <LjDialog v-model="internalShow" :title="title || t('library.load_title')" size="md">
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

    <div v-if="hasAnything" class="llo-list">
      <!-- A liturgia do dia da semana, mesmo sem estar salva na biblioteca. -->
      <div v-if="filteredOption" class="llo-item" data-testid="llo-option-extra">
        <button type="button" class="llo-item__main" @click="pickOption(filteredOption)">
          <LjIcon
            :icon="ICONS.MODULES.LITURGY"
            :size="18"
            :color="DEFAULT_COLOR"
            class="llo-item__icon"
          />
          <span class="llo-item__text">
            <span class="llo-item__name">{{ filteredOption.name }}</span>
            <span v-if="filteredOption.subtitle" class="llo-item__date">
              {{ filteredOption.subtitle }}
            </span>
          </span>
        </button>
      </div>

      <div v-for="item in filtered" :key="item.id" class="llo-item">
        <button type="button" class="llo-item__main" @click="pickLibrary(item)">
          <LjIcon
            :icon="ICONS.MODULES.LITURGY"
            :size="18"
            :color="item.color || DEFAULT_COLOR"
            class="llo-item__icon"
          />
          <span class="llo-item__text">
            <span class="llo-item__name">{{ item.name }}</span>
            <span v-if="item.updatedAt || bindingLabel(item)" class="llo-item__date">
              <span v-if="item.updatedAt">{{ formatDate(item.updatedAt) }}</span>
              <span v-if="bindingLabel(item)" class="llo-item__binding">
                {{ bindingLabel(item) }}
              </span>
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

    <LjEmpty
      v-else-if="!library.loading.value"
      class="llo-feedback"
      :icon="ICONS.LITURGY.SCRIPT"
      :title="t('library.load_empty')"
    />

    <LjProgress v-if="library.loading.value" class="llo-feedback" indeterminate />
  </LjDialog>
</template>

<script setup lang="ts">
import { useLiturgyI18n } from "../i18n";
import { ref, computed, watch } from "vue";
import { LjButton, LjDialog, LjEmpty, LjIcon, LjInput, LjProgress } from "@/components/ui";
import $alert, { escapeHtml } from "@/helpers/Alert";
import { useLiturgyLibrary, WEEKDAY_KEYS } from "../composables/useLiturgyLibrary";
import { DEFAULT_COLOR } from "../composables/useLiturgyItems";
import { ICONS } from "@/config/Icons";
import { localeTag } from "@/helpers/DateTime";
import type { LiturgyOptionExtra, LiturgyLibraryItem, LiturgyPick } from "@/types/LiturgyLibrary";

const props = defineProps<{
  modelValue: boolean;
  /** Título alternativo (o Modo apresentação usa “Importar liturgia”). */
  title?: string;
  /** A liturgia do dia da semana, mostrada acima da biblioteca. */
  optionExtra?: LiturgyOptionExtra | null;
}>();
const emit = defineEmits<{
  "update:modelValue": [v: boolean];
  picked: [item: LiturgyPick];
  deleted: [id: string];
}>();

const { t, locale } = useLiturgyI18n();

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

const filteredOption = computed(() => {
  const option = props.optionExtra;
  if (!option?.items.length) return null;
  const q = search.value.trim().toLowerCase();
  if (!q) return option;
  return `${option.name} ${option.subtitle ?? ""}`.toLowerCase().includes(q) ? option : null;
});

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  return q ? allItems.value?.filter((i) => i.name.toLowerCase().includes(q)) : allItems.value;
});

const hasAnything = computed(() => !!filteredOption.value || !!filtered.value?.length);

watch(internalShow, async (v) => {
  if (v) {
    search.value = "";
    allItems.value = await library.list();
  }
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(localeTag(locale.value));
}

/** O vínculo da liturgia, do jeito que ele decide a data do programa. */
function bindingLabel(item: LiturgyLibraryItem): string {
  const binding = item.binding;
  if (!binding) return "";
  if (binding.type === "day_of_week") {
    const key = WEEKDAY_KEYS[Number(binding.value)];
    return key ? t(`library.weekday_${key}`) : "";
  }
  if (binding.type === "date") {
    const date = new Date(`${binding.value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(localeTag(locale.value));
  }
  if (binding.type === "thirteenth_sabbath") return t("library.manage_binding_13th");
  return "";
}

function pickOption(option: LiturgyOptionExtra): void {
  confirmPick({ id: null, name: option.name, items: option.items, binding: null });
}

async function pickLibrary(item: LiturgyLibraryItem): Promise<void> {
  const full = await library.get(item.id);
  if (!full) return;
  confirmPick({
    id: full.id,
    name: full.name,
    items: full.items,
    binding: full.binding ?? null,
  });
}

function confirmPick(pick: LiturgyPick): void {
  $alert.yesno(
    {
      title: props.title || t("library.load_title"),
      text: t("library.load_confirm"),
    },
    (btn?: string) => {
      if (btn !== "yes") return;
      internalShow.value = false;
      emit("picked", pick);
    }
  );
}

async function duplicateItem(item: LiturgyLibraryItem) {
  const full = await library.get(item.id);
  if (!full) return;
  let name = `${t("library.duplicate_prefix")} ${full.name}`;
  let n = 1;
  while (await library.getByName(name)) {
    n++;
    name = `${t("library.duplicate_prefix_n", { n })} ${full.name}`;
  }
  const saved = await library.save({ name, items: full.items, color: full.color, binding: null });
  $alert.info({
    text: t("library.duplicate_success", { name: escapeHtml(saved.name) }),
    translate: false,
  });
  allItems.value = await library.list();
}

async function deleteItem(item: LiturgyLibraryItem) {
  $alert.yesno(
    {
      title: t("actions.delete"),
      text: t("library.delete_confirm", { name: escapeHtml(item.name) }),
      translate: false,
      destructive: true,
    },
    async (btn?: string) => {
      if (btn !== "yes") return;
      await library.remove(item.id);
      allItems.value = await library.list();
      emit("deleted", item.id);
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
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}

/* Vínculo da liturgia: é ele que decide a data ao importar no programa. */
.llo-item__binding {
  padding: 0 var(--lj-space-2);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
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
