<template>
  <button
    class="lj-copy-btn"
    :class="[{ 'lj-copy-btn--copied': copied }, attrs.class]"
    @click="handleCopy"
  >
    <slot v-if="!copied" />
    <span v-else class="lj-copy-btn__label">
      <LjIcon :icon="ICONS.UI.CHECK" :size="13" />
      {{ t("components.ui.copied") }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { ref, useAttrs } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const attrs = useAttrs();

const props = withDefaults(
  defineProps<{
    value: string;
    duration?: number;
  }>(),
  { duration: 3000 }
);

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function handleCopy() {
  if (!props.value) return;
  navigator.clipboard.writeText(props.value).catch(() => {});
  if (timer) clearTimeout(timer);
  copied.value = true;
  timer = setTimeout(() => {
    copied.value = false;
    timer = null;
  }, props.duration);
}
</script>

<style scoped>
.lj-copy-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.lj-copy-btn__label {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  color: var(--lj-success);
}
</style>
