<template>
  <LjDialog v-model="model" :title="$t('classic.title')" :icon="ICONS.UI.MONITORS" persistent>
    <!-- Scanning -->
    <div v-if="view === 'scanning'" class="cv-center">
      <LjSpinner :size="32" />
      <span>{{ $t("classic.scanning") }}</span>
    </div>

    <!-- Detected -->
    <div v-else-if="view === 'detected'" class="cv-stack">
      <div class="cv-row">
        <Icon :icon="ICONS.UI.CHECK" :size="18" class="cv-ok" />
        <span>{{ $t("classic.detected") }}</span>
      </div>

      <code class="cv-path">{{ result?.installDir }}</code>

      <div class="cv-folders">
        <LjChip
          v-for="(exists, folder) in result?.folders"
          :key="folder"
          size="sm"
          :variant="exists ? 'success' : 'neutral'"
          :icon="exists ? ICONS.UI.FOLDER : ICONS.UI.FOLDER_OFF"
        >
          {{ folder }}
        </LjChip>
      </div>

      <p v-if="result?.lang" class="cv-hint">
        {{ $t("classic.language_detected", { lang: result.lang.toUpperCase() }) }}
      </p>
    </div>

    <!-- Not found -->
    <div v-else-if="view === 'not_found'" class="cv-row">
      <Icon :icon="ICONS.UI.ALERT" :size="18" class="cv-warn" />
      <span>{{ $t("classic.not_found") }}</span>
    </div>

    <template v-if="view !== 'scanning'" #footer>
      <template v-if="view === 'detected'">
        <LjButton size="sm" @click="onDecline">{{ $t("classic.decline") }}</LjButton>
        <LjButton size="sm" variant="primary" @click="onAccept">
          {{ $t("classic.accept") }}
        </LjButton>
      </template>
      <LjButton v-else size="sm" variant="primary" @click="onClose">{{ $t("alert.ok") }}</LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { LjButton, LjChip, LjDialog, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import Platform from "@/helpers/Platform";

interface ClassicDetectResult {
  detected: boolean;
  installDir: string;
  configDir: string;
  lang: "pt" | "es" | null;
  folders: {
    capas: boolean;
    imagens: boolean;
    musicas: boolean;
  };
}

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
}>();

const { t } = useI18n();

const model = ref(props.modelValue);
const view = ref<"scanning" | "detected" | "not_found">("scanning");
const result = ref<ClassicDetectResult | null>(null);

watch(
  () => props.modelValue,
  (v) => {
    model.value = v;
    if (v) {
      runDetection();
    }
  }
);

watch(model, (v) => emit("update:modelValue", v));

async function runDetection(): Promise<void> {
  view.value = "scanning";
  result.value = null;

  if (!Platform.classic?.detect) {
    view.value = "not_found";
    return;
  }

  try {
    const res = (await Platform.classic.detect()) as ClassicDetectResult;
    result.value = res;

    if (res.detected) {
      view.value = "detected";
    } else {
      view.value = "not_found";
    }
  } catch {
    view.value = "not_found";
  }
}

function onAccept(): void {
  if (!result.value) return;

  $userdata.set(KEYS.OPTIONS.USE_CLASSIC_DIR, true);
  $userdata.set(KEYS.OPTIONS.CLASSIC_LANG, result.value.lang || "pt");

  const cur = Platform.userStore?.read?.("storage") || {};
  Platform.userStore?.write?.("storage", {
    ...cur,
    classicDir: result.value.configDir,
    classicLang: result.value.lang || "pt",
    useClassicDir: true,
  });
  Platform.storage?.setFilesDir?.(result.value.configDir, { moveExisting: false });

  onClose();
}

function onDecline(): void {
  onClose();
}

function onClose(): void {
  $userdata.set(KEYS.OPTIONS.SKIP_CLASSIC_CHECK, true);
  model.value = false;
  emit("update:modelValue", false);
}
</script>

<style scoped>
.cv-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-7) 0;
}

.cv-stack {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

.cv-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}

.cv-ok {
  color: var(--lj-success);
}

.cv-warn {
  color: var(--lj-warning);
}

.cv-path {
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-xs);
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-sm);
  word-break: break-all;
}

.cv-folders {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
}

.cv-hint {
  margin: 0;
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}
</style>
