<template>
  <LjDialog
    :model-value="internalShow"
    :title="t('release_notes.title')"
    :icon="ICONS.UI.NEWS"
    size="md"
    @update:model-value="onDialogModel"
  >
    <div v-if="loading" class="rn-center">
      <LjSpinner :size="32" />
      <span>{{ t("release_notes.loading") }}</span>
    </div>

    <div v-else-if="error" class="rn-alert" role="alert">
      <Icon :icon="ICONS.UI.ALERT" :size="ICON_SIZE.lg" class="rn-alert__icon" />
      <span>{{ t("release_notes.error_offline") }}</span>
    </div>

    <template v-else-if="release">
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
          <Icon :icon="ICONS.UI.OPEN_IN_NEW" :size="ICON_SIZE.sm" />
          {{ t("release_notes.view_on_github") }}
        </a>
      </div>
    </template>

    <template #footer>
      <div class="rn-footer">
        <DontShowAgainCheckbox
          :storage-key="KEYS.OPTIONS.SKIP_RELEASE_NOTES_VERSION"
          :value="packageJson.version"
          :label="t('release_notes.dont_show_again')"
        />
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
import Platform from "@/helpers/Platform";
import Icon from "@/components/Icon.vue";
import DontShowAgainCheckbox from "@/components/inputs/DontShowAgainCheckbox.vue";
import { ICON_SIZE, LjButton, LjDialog, LjSpinner } from "@/components/ui";
import { KEYS } from "@/constants/UserDataKeys";
import packageJson from "@root/package.json";
import { ICONS } from "@/config/Icons";

const props = defineProps<{
  modelValue: boolean;
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
    if (v) load();
  }
);

const loading = ref(false);
const error = ref(false);
const release = ref<{
  version: string;
  name: string;
  body: string;
  bodyHtml: string | null;
  url: string;
} | null>(null);

async function load() {
  loading.value = true;
  error.value = false;
  release.value = null;
  try {
    const data = Platform.updater ? await Platform.updater.getReleaseNotes() : null;
    release.value = data;
    if (!data) error.value = true;
  } catch (e) {
    console.warn("[ReleaseNotesDialog] load falhou:", e);
    error.value = true;
  } finally {
    loading.value = false;
  }
}

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
.rn-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-7) 0;
}

/* Sem primitivo de alerta no catálogo: cor na borda e no ícone, como o LjToast. */
.rn-alert {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4) var(--lj-space-5);
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
  border-left: 3px solid var(--lj-warning);
  border-radius: var(--lj-radius-md);
  line-height: 1.45;
}

.rn-alert__icon {
  flex-shrink: 0;
  color: var(--lj-warning);
}

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
