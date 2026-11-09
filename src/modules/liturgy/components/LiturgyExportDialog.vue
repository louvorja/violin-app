<template>
  <LjDialog v-model="internalShow" :title="t('library.export_title')" size="sm">
    <div class="liturgy-export" data-testid="liturgy-export-dialog">
      <p class="liturgy-export__hint">{{ t("library.export_dialog_hint") }}</p>

      <LjCheckbox
        :model-value="counts.liturgy > 0"
        disabled
        :label="`${t('library.export_opt_liturgy')} (${counts.liturgy})`"
      />
      <LjCheckbox
        :model-value="options.media && counts.media > 0"
        :disabled="!counts.media"
        @update:model-value="options.media = $event"
        data-testid="liturgy-export-media"
        :label="`${t('library.export_opt_media')} (${counts.media})`"
      />
      <LjCheckbox
        :model-value="options.backgroundSound && counts.backgroundSound > 0"
        :disabled="!counts.backgroundSound"
        @update:model-value="options.backgroundSound = $event"
        data-testid="liturgy-export-bg-sound"
        :label="`${t('library.export_opt_bg_sound')} (${counts.backgroundSound})`"
      />
      <LjCheckbox
        :model-value="options.backgroundProjection && counts.backgroundProjection > 0"
        :disabled="!counts.backgroundProjection"
        @update:model-value="options.backgroundProjection = $event"
        data-testid="liturgy-export-bg-projection"
        :label="`${t('library.export_opt_bg_projection')} (${counts.backgroundProjection})`"
      />
    </div>

    <template #footer>
      <LjButton variant="ghost" @click="internalShow = false">
        {{ t("actions.cancel") }}
      </LjButton>
      <LjButton
        variant="primary"
        :icon="ICONS.ACTIONS.EXPORT"
        data-testid="liturgy-export-confirm"
        @click="submit"
      >
        {{ t("library.export_confirm") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
/**
 * Escolha do que vai no pacote ao exportar a liturgia. Os arquivos dos itens do
 * tipo arquivo vão sempre; o que é das bibliotecas, conforme as caixas — a
 * Projeção de Fundo vai inteira e começa desmarcada (a liturgia ainda não
 * aponta para ela, e a biblioteca costuma ser grande).
 */
import { reactive, ref, watch } from "vue";
import { useLiturgyI18n } from "../i18n";
import { LjButton, LjCheckbox, LjDialog } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { DEFAULT_EXPORT_OPTIONS, type ExportCounts, type ExportOptions } from "../package/collect";

const props = defineProps<{
  modelValue: boolean;
  counts: ExportCounts;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "confirm", options: ExportOptions): void;
}>();

const { t } = useLiturgyI18n();

const internalShow = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    internalShow.value = v;
  }
);
watch(internalShow, (v) => emit("update:modelValue", v));

const options = reactive<ExportOptions>({ ...DEFAULT_EXPORT_OPTIONS });
watch(internalShow, (v) => {
  if (v) Object.assign(options, DEFAULT_EXPORT_OPTIONS);
});

function submit() {
  const chosen: ExportOptions = {
    media: options.media && props.counts.media > 0,
    backgroundSound: options.backgroundSound && props.counts.backgroundSound > 0,
    backgroundProjection: options.backgroundProjection && props.counts.backgroundProjection > 0,
  };
  internalShow.value = false;
  emit("confirm", chosen);
}
</script>

<style scoped>
.liturgy-export {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}
.liturgy-export__hint {
  margin: 0;
  color: var(--lj-text-muted);
}
</style>
