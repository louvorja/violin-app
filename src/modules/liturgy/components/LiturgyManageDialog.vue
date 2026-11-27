<template>
  <LjDialog v-model="internalShow" :title="t('library.manage_title')" size="md">
    <LjField layout="column" :label="t('library.manage_name')" :error="nameError">
      <LjInput v-model="form.name" />
    </LjField>

    <LjField layout="column" :label="t('inputs.color')">
      <LjPopover :title="t('inputs.color')">
        <template #trigger>
          <LjButton
            size="md"
            class="lmd-color-trigger"
            :icon-end="ICONS.UI.MENU_DOWN"
            :aria-label="t('inputs.color')"
          >
            <span class="lmd-color-trigger__inner">
              <span class="lmd-color-trigger__dot" :style="{ background: form.color }" />
              <span class="lmd-color-trigger__hex">{{ form.color.toUpperCase() }}</span>
            </span>
          </LjButton>
        </template>
        <LjColorPicker v-model="form.color" :presets="COLORS" :label="t('inputs.color')" />
      </LjPopover>
    </LjField>

    <LjDivider class="lmd-divider" />

    <LjField layout="column" :label="t('library.manage_binding')" class="lmd-binding-field">
      <LjSelect
        :model-value="bindingType"
        :items="bindingOptions"
        @update:model-value="bindingType = String($event)"
      />
    </LjField>

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
      <LjButton size="sm" variant="ghost" @click="internalShow = false">
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
import { useLiturgyI18n } from "../i18n";
import { computed, reactive, ref, watch } from "vue";
import {
  LjButton,
  LjColorPicker,
  LjDialog,
  LjDivider,
  LjField,
  LjInput,
  LjPopover,
  LjSelect,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import $alert, { escapeHtml } from "@/helpers/Alert";
import $liturgy from "@/helpers/Liturgy";
import { useLiturgyLibrary } from "../composables/useLiturgyLibrary";
import { COLORS } from "../composables/useLiturgyItems";

const { t } = useLiturgyI18n();

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
    $alert.info({ text: escapeHtml(t("library.no_liturgy_selected")), translate: false });
    internalShow.value = false;
    return;
  }
  const item = await library.get(currentId);
  if (!item) {
    $alert.info({ text: escapeHtml(t("library.no_liturgy_selected")), translate: false });
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
  const [current, existing] = await Promise.all([library.get(currentId), library.getByName(n)]);
  if (!current) return;
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
    items: current.items ?? [],
    binding,
  });
  $liturgy.setCurrentLiturgyId(saved.id);
  internalShow.value = false;
  emit("managed");
}
</script>

<style scoped>
/* ====================== Seletor de cor ====================== */
.lmd-color-trigger__inner {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
}

.lmd-color-trigger__dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(var(--lj-on-surface-ch), 0.2);
  flex-shrink: 0;
  forced-color-adjust: none;
}

.lmd-color-trigger__hex {
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

/* ====================== Seção de vínculo ====================== */
.lmd-divider {
  margin: var(--lj-space-5) 0;
}

.lmd-binding-field {
  margin-bottom: var(--lj-space-4);
}
</style>
