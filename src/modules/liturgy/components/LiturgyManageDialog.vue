<template>
  <LjDialog v-model="internalShow" :title="t('library.manage_title')" size="md">
    <LjField layout="column" :label="t('library.manage_name')" :error="nameError">
      <LjInput v-model="form.name" />
    </LjField>

    <LjField layout="column" :label="t('inputs.color')">
      <div class="lmd-color">
        <input
          :value="form.color"
          type="color"
          class="lmd-color__swatch"
          :aria-label="t('inputs.color')"
          @input="form.color = ($event.target as HTMLInputElement).value"
        />
        <button
          type="button"
          class="lmd-color__toggle"
          :aria-expanded="presetsOpen"
          :aria-label="t('inputs.color')"
          @click.stop="presetsOpen = !presetsOpen"
        >
          <Icon :icon="ICONS.UI.MENU_DOWN" :size="14" />
        </button>
        <div v-if="presetsOpen" class="lmd-color__presets" @click="presetsOpen = false">
          <span
            v-for="c in COLORS"
            :key="c"
            class="lmd-color__preset"
            :class="{ 'is-active': form.color?.toLowerCase() === c.toLowerCase() }"
            :style="{ background: c }"
            @click="form.color = c"
          />
        </div>
      </div>
    </LjField>

    <hr class="lmd-divider" />

    <p class="lmd-section">{{ t("library.manage_binding") }}</p>

    <div class="lmd-radios" role="radiogroup" :aria-label="t('library.manage_binding')">
      <label v-for="opt in bindingOptions" :key="opt.value" class="lmd-radio">
        <input
          v-model="bindingType"
          type="radio"
          class="lmd-radio__input"
          :name="radioName"
          :value="opt.value"
        />
        <span class="lmd-radio__mark" aria-hidden="true" />
        <span class="lmd-radio__label">{{ opt.label }}</span>
      </label>
    </div>

    <LjSelect
      v-if="bindingType === 'day_of_week'"
      :model-value="bindingValue"
      :items="dayOptions"
      item-label="title"
      :placeholder="t('library.manage_binding_day_placeholder')"
      @update:model-value="bindingValue = String($event)"
    />

    <LjInput v-if="bindingType === 'date'" v-model="bindingValue" type="date" />

    <template #footer>
      <LjButton size="sm" @click="internalShow = false">
        {{ t("actions.cancel") }}
      </LjButton>
      <LjButton
        size="sm"
        variant="primary"
        :icon="ICONS.UI.CHECK"
        :disabled="!form.name.trim()"
        @click="doSave"
      >
        {{ t("actions.save") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import pt from "../lang/pt.json";
import es from "../lang/es.json";
import Icon from "@/components/Icon.vue";
import { LjButton, LjDialog, LjField, LjInput, LjSelect } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import $alert from "@/helpers/Alert";
import $liturgy from "@/helpers/Liturgy";
import { useLiturgyLibrary } from "../composables/useLiturgyLibrary";
import { COLORS } from "../composables/useLiturgyItems";

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

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "managed"): void;
}>();
const props = defineProps<{ modelValue: boolean }>();

const library = useLiturgyLibrary();
const internalShow = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    internalShow.value = v;
  }
);
watch(internalShow, (v) => emit("update:modelValue", v));

const form = reactive({ name: "", color: "#00004F" });
const bindingType = ref("");
const bindingValue = ref("");
const nameError = ref("");
const presetsOpen = ref(false);

// Sem `name` compartilhado os rádios nativos não se excluem entre si; o id
// gerado mantém o grupo isolado caso o diálogo apareça mais de uma vez na tela.
const radioName = useId();

const bindingOptions = computed(() => [
  { value: "", label: t("library.manage_binding_none") },
  { value: "day_of_week", label: t("library.manage_binding_day") },
  { value: "date", label: t("library.manage_binding_date") },
  { value: "thirteenth_sabbath", label: t("library.manage_binding_13th") },
]);

const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const dayOptions = computed(() =>
  WEEKDAY_KEYS.map((key, index) => ({
    title: t(`library.weekday_${key}`),
    value: String(index),
  }))
);

watch(internalShow, async (v) => {
  if (!v) return;
  nameError.value = "";
  const currentId = $liturgy.getCurrentLiturgyId();
  if (!currentId) {
    $alert.info({ text: t("library.no_liturgy_selected") });
    internalShow.value = false;
    return;
  }
  const item = await library.get(currentId);
  if (!item) {
    $alert.info({ text: t("library.no_liturgy_selected") });
    internalShow.value = false;
    return;
  }
  form.name = item.name;
  form.color = item.color;
  if (item.binding) {
    bindingType.value = item.binding.type;
    bindingValue.value = item.binding.value;
  } else {
    bindingType.value = "";
    bindingValue.value = "";
  }
});

async function doSave() {
  const n = form.name.trim();
  if (!n) return;
  nameError.value = "";
  const currentId = $liturgy.getCurrentLiturgyId();
  if (!currentId) return;
  const existing = await library.getByName(n);
  if (existing && existing.id !== currentId) {
    nameError.value = t("library.name_exists");
    return;
  }
  const binding = bindingType.value
    ? {
        type: bindingType.value as "day_of_week" | "date" | "thirteenth_sabbath",
        value: bindingValue.value,
      }
    : null;
  const saved = await library.save({
    id: currentId,
    name: n,
    color: form.color,
    items: existing?.items ?? [],
    binding,
  });
  $liturgy.setCurrentLiturgyId(saved.id);
  internalShow.value = false;
  emit("managed");
}
</script>

<style scoped>
/* ====================== Seletor de cor ======================
   Sem primitivo equivalente no catálogo: o <input type="color"> nativo abre o
   seletor do sistema e a paleta ao lado é atalho para as cores da liturgia. */
.lmd-color {
  display: inline-flex;
  align-items: center;
  position: relative;
}

.lmd-color__swatch {
  width: var(--lj-fixed-btn-width);
  height: var(--lj-ui-h-md);
  padding: 0;
  background: transparent;
  border: var(--lj-ui-border);
  border-right: 0;
  border-radius: var(--lj-ui-radius) 0 0 var(--lj-ui-radius);
  cursor: pointer;
}

.lmd-color__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: var(--lj-ui-h-md);
  padding: 0;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: 0 var(--lj-ui-radius) var(--lj-ui-radius) 0;
  color: var(--lj-text);
  cursor: pointer;
}

.lmd-color__toggle:hover {
  background: var(--lj-surface-bg-hover);
}

.lmd-color__toggle:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
  border-color: var(--lj-ui-accent);
}

.lmd-color__presets {
  position: absolute;
  top: calc(100% + var(--lj-space-2));
  left: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--lj-space-2);
  padding: var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-float-border);
  border-radius: var(--lj-radius-md);
  box-shadow: var(--lj-ui-float-shadow);
}

.lmd-color__preset {
  width: 18px;
  height: 18px;
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-xs);
  cursor: pointer;
}

.lmd-color__preset:hover {
  transform: scale(1.15);
}

.lmd-color__preset.is-active {
  border-color: var(--lj-white);
  box-shadow: 0 0 0 2px var(--lj-ui-accent);
}

/* ====================== Seção de vínculo ====================== */
.lmd-divider {
  margin: 0 0 var(--lj-space-5);
  border: 0;
  border-top: 1px solid var(--lj-surface-divider);
}

.lmd-section {
  margin: 0 0 var(--lj-space-4);
  color: var(--lj-text);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

/* Rádio não existe no catálogo — markup nativo sobre os mesmos tokens do
   LjCheckbox para o grupo não destoar dos demais controles. */
.lmd-radios {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  margin-bottom: var(--lj-space-5);
}

.lmd-radio {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
  color: var(--lj-text);
  font-size: var(--lj-text-base);
  cursor: pointer;
  user-select: none;
}

/* Input real fica invisível mas focável — o :focus-visible dele estiliza a marca */
.lmd-radio__input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.lmd-radio__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: 50%;
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lmd-radio__mark::after {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--lj-ui-accent-fg);
  transform: scale(0);
  transition: transform var(--lj-transition-fast);
}

.lmd-radio__input:checked + .lmd-radio__mark {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
}

.lmd-radio__input:checked + .lmd-radio__mark::after {
  transform: scale(1);
}

.lmd-radio__input:focus-visible + .lmd-radio__mark {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.lmd-radio:hover .lmd-radio__mark {
  border-color: var(--lj-ui-accent);
}
</style>
