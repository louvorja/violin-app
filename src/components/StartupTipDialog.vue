<template>
  <LjDialog
    :model-value="model"
    :title="t('startup_tips.title')"
    :icon="ICONS.CATEGORY.SPARKLES"
    size="md"
    @update:model-value="onDialogModel"
  >
    <div v-if="tip" class="startup-tip" aria-live="polite">
      <div class="startup-tip__kind">
        {{
          t(
            tip.kind === "shortcut"
              ? "startup_tips.shortcut_label"
              : tip.kind === "module"
                ? "startup_tips.module_label"
                : "startup_tips.feature_label"
          )
        }}
      </div>

      <template v-if="tip.kind === 'shortcut'">
        <ShortcutKeys :parts="tip.parts" large class="startup-tip__keys" />
        <p class="startup-tip__body">{{ t(tip.descriptionKey) }}</p>
        <p class="startup-tip__explanation">{{ t(tip.detailKey) }}</p>
      </template>

      <template v-else>
        <div class="startup-tip__heading">
          <LjIcon :icon="tip.icon" :size="24" />
          <span>{{ t(tip.titleKey) }}</span>
        </div>
        <p class="startup-tip__body">{{ t(tip.bodyKey) }}</p>
      </template>
    </div>

    <template #footer>
      <div class="startup-tip__footer">
        <LjCheckbox v-model="dontShowAgain" :label="t('startup_tips.dont_show_again')" />
        <div class="startup-tip__actions">
          <LjButton
            v-if="showPrevious"
            size="sm"
            variant="subtle"
            :disabled="previousDisabled"
            @click="emit('previous')"
          >
            {{ t("startup_tips.previous") }}
          </LjButton>
          <LjButton size="sm" variant="subtle" :disabled="nextDisabled" @click="emit('next')">
            {{ t("startup_tips.next") }}
          </LjButton>
          <LjButton size="sm" variant="primary" @click="onClose">
            {{ t("actions.close") }}
          </LjButton>
        </div>
      </div>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton, LjCheckbox, LjDialog, LjIcon } from "@/components/ui";
import ShortcutKeys from "@/components/ShortcutKeys.vue";
import { ICONS } from "@/config/Icons";
import { KEYS } from "@/constants/UserDataKeys";
import UserData from "@/helpers/UserData";
import type { StartupTip } from "@/helpers/StartupTips";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    tip: StartupTip | null;
    showPrevious?: boolean;
    previousDisabled?: boolean;
    nextDisabled?: boolean;
  }>(),
  { showPrevious: false, previousDisabled: true, nextDisabled: false }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  close: [];
  previous: [];
  next: [];
}>();

const { t } = useI18n();
const dontShowAgain = ref(false);

const model = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) dontShowAgain.value = false;
  }
);

function onClose(): void {
  if (dontShowAgain.value) {
    UserData.set(KEYS.OPTIONS.SHOW_STARTUP_TIPS, false);
  }
  model.value = false;
  emit("close");
}

function onDialogModel(value: boolean): void {
  if (!value) onClose();
}
</script>

<style scoped>
.startup-tip {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

.startup-tip__kind {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.startup-tip__keys {
  align-self: center;
}

.startup-tip__heading {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-semibold);
}

.startup-tip__body {
  margin: 0;
  color: var(--lj-text);
  font-size: var(--lj-text-lg);
  line-height: 1.55;
}

.startup-tip__explanation {
  margin: 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
  line-height: 1.5;
}

/* O rodapé do diálogo alinha à direita; o checkbox fica à esquerda. */
.startup-tip__footer {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-4);
}

.startup-tip__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--lj-space-3);
}
</style>
