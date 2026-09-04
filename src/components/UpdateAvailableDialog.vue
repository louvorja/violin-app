<template>
  <LjDialog
    :model-value="internalShow"
    :title="t('options.updates.app_available', { version })"
    :icon="ICONS.ACTIONS.DOWNLOAD"
    icon-variant="warning"
    @update:model-value="onClose"
  >
    <!-- Estado: baixando -->
    <div v-if="isDownloading" class="ua-state">
      <LjSpinner :size="40" class="ua-state__spinner" />
      <span class="ua-state__label">{{ t("options.updates.app_downloading") }}</span>

      <div v-if="appUpdate.progress > 0" class="ua-progress">
        <LjProgress :value="appUpdate.progress" :height="8" />
        <div class="ua-progress__row">
          <span>{{ formatRate(appUpdate.bytesPerSecond) }}</span>
          <span>{{ appUpdate.progress }}%</span>
        </div>
        <div class="ua-progress__row">
          <span>{{ formatBytes(appUpdate.transferred) }} / {{ formatBytes(appUpdate.total) }}</span>
          <span v-if="etaSeconds != null">~{{ formatEta(etaSeconds) }}</span>
          <span v-else>—</span>
        </div>
      </div>
    </div>

    <!-- Estado: baixado — pronto para instalar -->
    <div v-else-if="isDownloaded" class="ua-state">
      <Icon :icon="ICONS.UI.CHECK_CIRCLE" :size="40" class="ua-state__ok" />
      <span class="ua-state__label ua-state__label--strong">
        {{ t("options.updates.app_downloaded") }}
      </span>
    </div>

    <!-- Estado: erro -->
    <template v-else-if="hasError">
      <p class="ua-alert" role="alert">{{ t("options.updates.app_error") }}</p>
      <p class="ua-hint">{{ t("options.updates.app_asset_missing") }}</p>
    </template>

    <!-- Estado: disponível — conteúdo principal -->
    <template v-else>
      <p class="ua-description">{{ t("options.updates.update_dialog_description") }}</p>
      <div v-if="releaseNotes" class="ua-notes">
        <div v-if="releaseNotesHtml" class="lj-md" v-html="releaseNotesHtml" />
        <pre v-else class="ua-notes__raw">{{ releaseNotes }}</pre>
      </div>
    </template>

    <!-- Ações -->
    <template #footer>
      <div v-if="!isDownloading && !isDownloaded && !hasError" class="ua-footer-start">
        <DontShowAgainCheckbox
          :key="version"
          :storage-key="KEYS.OPTIONS.SKIP_UPDATE_NOTIFICATION_VERSION"
          :value="version"
          :label="t('release_notes.dont_show_again')"
        />
      </div>

      <!-- Estado disponível: Atualizar / Depois -->
      <template v-if="!isDownloading && !isDownloaded && !hasError">
        <LjButton size="sm" @click="onClose">{{ t("options.updates.later") }}</LjButton>
        <LjButton size="sm" variant="primary" :icon="ICONS.ACTIONS.DOWNLOAD" @click="startDownload">
          {{ t("options.updates.update_now") }}
        </LjButton>
      </template>

      <!-- Estado baixado: Instalar -->
      <template v-else-if="isDownloaded">
        <LjButton size="sm" variant="primary" :icon="ICONS.UI.INSTALL" @click="install">
          {{ t("options.updates.app_install_close") }}
        </LjButton>
      </template>

      <!-- Estado erro: Baixar manualmente / Fechar -->
      <template v-else-if="hasError">
        <LjButton size="sm" variant="ghost" @click="onClose">{{ t("actions.close") }}</LjButton>
        <LjButton size="sm" variant="primary" :icon="ICONS.UI.OPEN_IN_NEW" @click="openReleasePage">
          {{ t("options.updates.download_manually") }}
        </LjButton>
      </template>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Platform from "@/helpers/Platform";
import Icon from "@/components/Icon.vue";
import DontShowAgainCheckbox from "@/components/inputs/DontShowAgainCheckbox.vue";
import { LjButton, LjDialog, LjProgress, LjSpinner } from "@/components/ui";
import { KEYS } from "@/constants/UserDataKeys";
import { ICONS } from "@/config/Icons";

interface AppUpdateState {
  status: string;
  version: string | null;
  progress: number;
  newVersion: string | null;
  error: string | null;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  packagePath?: string | null;
}

const props = defineProps<{
  modelValue: boolean;
  version: string;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "start-download"): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

const internalShow = ref(props.modelValue);
const releaseNotes = ref<string | null>(null);
const releaseNotesHtml = ref<string | null>(null);
const appUpdate = ref<AppUpdateState>({
  status: "idle",
  version: "?",
  progress: 0,
  newVersion: null,
  error: null,
});

let _unsub: (() => void) | null = null;

watch(
  () => props.modelValue,
  (v) => {
    internalShow.value = v;
    if (v) load();
    else cleanup();
  }
);

const isDownloading = computed(() => appUpdate.value.status === "downloading");
const isDownloaded = computed(() => appUpdate.value.status === "downloaded");
const hasError = computed(() => appUpdate.value.status === "error");

// Tempo estimado restante (segundos) com base na taxa atual de download.
const etaSeconds = computed<number | null>(() => {
  const rate = appUpdate.value.bytesPerSecond || 0;
  const transferred = appUpdate.value.transferred || 0;
  const total = appUpdate.value.total || 0;
  if (rate <= 0 || total <= 0) return null;
  const remaining = Math.max(0, total - transferred);
  return remaining / rate;
});

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRate(bytesPerSecond?: number): string {
  return formatBytes(bytesPerSecond) + "/s";
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

async function load() {
  releaseNotes.value = null;
  releaseNotesHtml.value = null;

  // Estado atual do updater
  if (Platform.updater) {
    appUpdate.value = (await Platform.updater.status()) as AppUpdateState;
  }

  // Release notes da versão NOVA (a oferecida no dialog)
  if (Platform.updater) {
    try {
      const notes = await Platform.updater.getReleaseNotes(props.version);
      if (notes) {
        releaseNotes.value = notes.body || null;
        releaseNotesHtml.value = notes.bodyHtml || null;
      }
    } catch (_) {
      /* ignore */
    }
  }

  // Inscrever mudanças de estado
  if (Platform.updater) {
    _unsub = Platform.updater.onStateChange((s: AppUpdateState) => {
      appUpdate.value = s;
    });
  }
}

function cleanup() {
  if (_unsub) {
    _unsub();
    _unsub = null;
  }
}

function startDownload() {
  emit("start-download");
}

function install() {
  if (Platform.updater) {
    Platform.updater.install();
  }
}

function openReleasePage() {
  if (Platform.updater) {
    Platform.updater.openReleasePage();
  }
  onClose();
}

function onClose() {
  internalShow.value = false;
  emit("update:modelValue", false);
  emit("close");
}
</script>

<style scoped>
.ua-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-6);
  padding: var(--lj-space-5) 0;
}

.ua-state__spinner {
  color: var(--lj-ui-accent-text);
}

.ua-state__ok {
  color: var(--lj-success);
}

.ua-state__label {
  color: var(--lj-text-muted);
}

.ua-state__label--strong {
  color: var(--lj-text);
  font-weight: var(--lj-weight-medium);
}

.ua-progress {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  width: 100%;
}

.ua-progress__row {
  display: flex;
  justify-content: space-between;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}

.ua-alert {
  margin: 0 0 var(--lj-space-5);
  padding: var(--lj-space-4) var(--lj-space-5);
  background: var(--lj-danger-soft);
  border: 1px solid var(--lj-danger-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-alert-error-color);
}

.ua-hint {
  margin: 0;
  color: var(--lj-text-muted);
  line-height: 1.5;
}

.ua-description {
  margin: 0;
  line-height: 1.5;
}

.ua-notes {
  max-height: 30vh;
  margin-top: var(--lj-space-5);
  overflow-y: auto;
}

.ua-notes__raw {
  margin: 0;
  font-family: inherit;
  font-size: var(--lj-text-base);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Conteúdo vindo de `v-html` não recebe o atributo de escopo — daí o :deep(). */

/* Empurra as ações para a direita, mantendo a caixa de seleção à esquerda. */
.ua-footer-start {
  margin-right: auto;
  min-width: 0;
}
</style>
