<template>
  <div class="statusbar">
    <div class="statusbar-cell statusbar-cell--main">{{ pcName }}</div>
    <!-- A apresentação segue no ar com a aba fechada: daqui o operador volta ou para. -->
    <div
      v-if="presentationOnAir"
      class="statusbar-cell statusbar-live"
      data-testid="statusbar-presentation"
    >
      <button type="button" class="statusbar-live__open" @click="openPresentation">
        <LjIcon :icon="ICONS.PROJECTION.PRESENTATION" :size="12" aria-hidden="true" />
        <span>{{ t("shell.presentation_on_air") }}</span>
      </button>
      <button
        type="button"
        class="statusbar-live__stop"
        :title="t('shell.stop_presentation')"
        :aria-label="t('shell.stop_presentation')"
        @click="stopPresentation"
      >
        <LjIcon :icon="ICONS.PROJECTION.STOP" :size="11" aria-hidden="true" />
      </button>
    </div>
    <div class="statusbar-cell statusbar-cell--num">{{ dateLabel }}</div>
    <div class="statusbar-cell statusbar-cell--num">{{ timeLabel }}</div>
    <div class="statusbar-cell statusbar-cell--version">{{ versionLabel }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import packageJson from "@root/package.json";
import $database from "@/helpers/Database";
import $appdata from "@/helpers/AppData";
import $modules from "@/helpers/Modules";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { ICONS } from "@/config/Icons";
import { KEYS } from "@/constants/UserDataKeys";
import { LjIcon } from "@/components/ui";

const { t } = useI18n();

/** O módulo publica `on_air` enquanto as telas de projeção estão abertas. */
const presentationOnAir = computed(
  () => $appdata.get(KEYS.MODULES.PRESENTATION_MODE.ON_AIR, false) === true
);

function openPresentation() {
  $modules.open("presentation_mode");
}

function stopPresentation() {
  // O mesmo "Parar" do ribbon: o módulo fecha as telas e publica `on_air` falso.
  Broadcast.send(BROADCAST_TYPE.MODULE_RIBBON_ACTION, {
    module: "presentation_mode",
    action: "stop",
  });
  $appdata.set(KEYS.MODULES.PRESENTATION_MODE.ON_AIR, false);
}

const dateLabel = ref("");
const timeLabel = ref("");
const dbVersion = ref(0);
let clockInterval = null;

const versionLabel = computed(() =>
  t("shell.version", { v: `${packageJson.version}.${dbVersion.value}` })
);

const pcName = computed(() => {
  if (typeof window === "undefined") return "PC";
  return "PC-" + (window.louvorjaApi?.platform || "WEB").toUpperCase();
});

function pad(n) {
  return String(n).padStart(2, "0");
}

function tick() {
  const now = new Date();
  dateLabel.value = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  timeLabel.value = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function loadDBVersion() {
  try {
    const config = await $database.get("config");
    dbVersion.value = config?.version_number ?? "?";
  } catch {
    dbVersion.value = "?";
  }
}

onMounted(() => {
  tick();
  clockInterval = setInterval(tick, 1000);
  loadDBVersion();
});

onBeforeUnmount(() => {
  if (clockInterval) clearInterval(clockInterval);
});
</script>

<style scoped>
.statusbar {
  display: flex;
  align-items: stretch;
  height: var(--lj-statusbar-height);
  background: var(--lj-statusbar-bg);
  border-top: 1px solid var(--lj-statusbar-border);
  flex-shrink: 0;
  font-size: var(--lj-text-sm);
  color: var(--lj-statusbar-color);
  user-select: none;
  font-family: var(--lj-font-shell);
}

.statusbar-cell {
  display: flex;
  align-items: center;
  padding: 0 var(--lj-space-5);
  border-right: 1px solid var(--lj-statusbar-divider);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Indicador "no ar": a apresentação segue com a aba fechada. */
.statusbar-live {
  gap: var(--lj-space-2);
  padding: 0 var(--lj-space-2) 0 0;
  color: var(--lj-danger);
  font-weight: var(--lj-weight-semibold);
}

.statusbar-live__open,
.statusbar-live__stop {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  height: 100%;
  padding: 0 var(--lj-space-3);
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.statusbar-live__open:hover,
.statusbar-live__stop:hover {
  background: var(--lj-statusbar-divider);
}

.statusbar-live__stop {
  padding: 0 var(--lj-space-2);
}

.statusbar-cell:last-child {
  border-right: none;
}

.statusbar-cell--main {
  flex: 1;
  min-width: 0;
}

.statusbar-cell--num {
  flex: 0 0 auto;
  min-width: 80px;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}

.statusbar-cell--version {
  flex: 0 0 auto;
  min-width: 130px;
  justify-content: flex-end;
}
</style>
