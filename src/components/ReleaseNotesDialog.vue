<template>
  <LjDialog
    :model-value="internalShow"
    :title="t('release_notes.title')"
    :icon="ICONS.UI.NEWS"
    size="md"
    @update:model-value="onDialogModel"
  >
    <template v-if="release">
      <div class="rn-head">
        <div class="rn-name">{{ release.name }}</div>
        <div class="rn-version">v{{ release.version }}</div>
      </div>

      <div class="rn-body">
        <div v-if="release.bodyHtml" class="lj-md" v-html="release.bodyHtml"></div>
        <pre v-else>{{ release.body || t("release_notes.no_notes") }}</pre>
      </div>

      <div class="rn-actions">
        <a class="rn-link" :href="release.url" target="_blank" rel="noopener noreferrer">
          <LjIcon :icon="ICONS.UI.OPEN_IN_NEW" :size="ICON_SIZE.sm" />
          {{ t("release_notes.view_on_github") }}
        </a>
      </div>
    </template>

    <template #footer>
      <div class="rn-footer">
        <LjButton size="sm" variant="primary" @click="onClose">
          {{ t("actions.close") }}
        </LjButton>
      </div>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ICON_SIZE, LjButton, LjDialog, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import type { ReleaseNotes } from "@/types/Update";

const props = defineProps<{
  modelValue: boolean;
  /** Notas já carregadas pelo Shell. Sem elas, o diálogo não deve ser aberto. */
  release: ReleaseNotes | null;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

const internalShow = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    internalShow.value = v;
  }
);

function onClose() {
  internalShow.value = false;
  emit("update:modelValue", false);
  emit("close");
}

/** Fechamento vindo do próprio LjDialog (clique fora / ESC / botão fechar). */
function onDialogModel(v: boolean) {
  if (!v) onClose();
}
</script>

<style scoped>
.rn-head {
  margin-bottom: var(--lj-space-5);
  padding-bottom: var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-divider);
}

.rn-name {
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-semibold);
  line-height: 1.3;
}

.rn-version {
  margin-top: var(--lj-space-1);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-md);
  font-variant-numeric: tabular-nums;
}

.rn-body {
  max-height: 46vh;
  overflow-y: auto;
}

.rn-body pre {
  margin: 0;
  font-family: inherit;
  font-size: var(--lj-text-lg);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.rn-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--lj-space-4);
}

/* Sem variante de link no LjButton: âncora com as medidas do contrato `sm`. */
.rn-link {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-ui-gap-sm);
  height: var(--lj-ui-h-sm);
  padding-inline: var(--lj-ui-px-sm);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-link-color);
  font-size: var(--lj-ui-font-sm);
  font-weight: var(--lj-weight-medium);
  text-decoration: none;
  white-space: nowrap;
}

.rn-link:hover {
  background: var(--lj-surface-bg-hover);
}

.rn-link:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* O rodapé do LjDialog alinha à direita; o "não mostrar novamente" fica à esquerda. */
.rn-footer {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-5);
}
</style>
