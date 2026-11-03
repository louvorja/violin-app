<template>
  <div class="field-image">
    <div class="field-image__row">
      <input
        type="text"
        :value="displayValue"
        class="format-field format-field--input field-image__input"
        :placeholder="t('components.customization.media_placeholder')"
        @input="onInput(($event.target as HTMLInputElement).value)"
      />
      <button
        class="field-image__btn"
        :title="t('components.customization.choose_file')"
        :aria-label="t('components.customization.choose_file')"
        @click="browse"
      >
        …
      </button>
      <button
        class="field-image__btn"
        :title="t('components.customization.choose_media')"
        :aria-label="t('components.customization.choose_media')"
        @click="mediaPickerOpen = true"
      >
        <LjIcon :icon="ICONS.MEDIA.LIBRARY" :size="14" />
      </button>
      <button
        v-if="modelValue"
        class="field-image__btn field-image__btn--clear"
        :title="t('components.customization.remove_image')"
        :aria-label="t('components.customization.remove_image')"
        @click="$emit('update:modelValue', '')"
      >
        ×
      </button>
    </div>
    <MediaBackgroundPicker v-model="mediaPickerOpen" @pick="onMediaPicked" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon } from "@/components/ui";
import MediaBackgroundPicker from "@/components/MediaBackgroundPicker.vue";
import { ICONS } from "@/config/Icons";
import $path from "@/helpers/Path";
import { pickBackgroundMedia } from "@/helpers/FilePicker";

interface CustomizationField {
  type: string;
  label?: string;
  default?: unknown;
  options?: string[];
}

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    field: CustomizationField;
  }>(),
  { modelValue: null }
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const { t } = useI18n();
const mediaPickerOpen = ref(false);
const LOCAL_PREFIX = "louvorja://local";

const displayValue = computed(() => {
  if (!props.modelValue) return "";
  if (props.modelValue.startsWith(LOCAL_PREFIX)) {
    return decodeURIComponent(props.modelValue.slice(LOCAL_PREFIX.length));
  }
  return props.modelValue;
});

function onInput(raw: string): void {
  if (!raw) {
    emit("update:modelValue", "");
    return;
  }
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    emit("update:modelValue", $path.local(raw));
  } else {
    emit("update:modelValue", raw);
  }
}

async function browse(): Promise<void> {
  const url = await pickBackgroundMedia();
  if (url) emit("update:modelValue", url);
}

function onMediaPicked(item: { url: string }): void {
  if (item.url) emit("update:modelValue", item.url);
}
</script>

<style scoped>
.field-image__row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.field-image__input {
  flex: 1;
  min-width: 0;
}
.field-image__btn {
  width: 26px;
  height: 26px;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-xs);
  background: var(--lj-surface-bg);
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}
.field-image__btn:hover {
  background: var(--lj-surface-bg-hover, #e0e0e0);
}
.field-image__btn--clear {
  color: #c00;
}
</style>
