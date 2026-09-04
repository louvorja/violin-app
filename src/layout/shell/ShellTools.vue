<template>
  <div class="shell-tools">
    <!--    Projeção de Fundo-->
    <LjTooltip
      :text="isBgPlaying ? 'Desativar projeção de fundo' : 'Ativar projeção de fundo'"
      side="bottom"
    >
      <button type="button" class="shell-tool" @click="toggleBackgroundProjection">
        <Icon
          :icon="!isBgPlaying ? ICONS.PROJECTION.START : ICONS.PROJECTION.STOP"
          :color="!isBgPlaying ? COLORS.SURFACE : COLORS.DANGER"
          :size="sizeIcon"
        />
      </button>
    </LjTooltip>

    <!--    Libras-->
    <LjTooltip
      :text="isLibrasEnabled ? $t('accessibility.musics.cached') + ' Libras' : 'Libras'"
      side="bottom"
    >
      <button
        type="button"
        class="shell-tool"
        :class="{ 'shell-tool--active': isLibrasEnabled }"
        @click="toggleLibras"
      >
        <Icon
          v-if="isLibrasEnabled"
          :icon="ICONS.UI.LIBRAS_ON"
          :size="sizeIcon"
          :color="COLORS.WARNING"
        />
        <Icon v-else :icon="ICONS.UI.LIBRAS_OFF" :size="sizeIcon" />
      </button>
    </LjTooltip>

    <!--    Atualização disponível-->
    <LjTooltip v-if="hasUpdate" :text="$t('shell.appmenu_items.check_update')" side="bottom">
      <button type="button" class="shell-tool shell-tool--update" @click="openUpdates">
        <Icon :icon="ICONS.UI.DOWNLOAD_CIRCLE" :size="sizeIcon" class="shell-tool--update-icon" />
      </button>
    </LjTooltip>

    <!--    Atividades em segundo plano-->
    <LjPopover :title="t('shell.background_tasks.title')" side="bottom" align="end">
      <template #trigger>
        <button
          type="button"
          class="shell-tool"
          :class="{ 'shell-tool--active': bgTasks.hasActiveTasks.value }"
          :aria-label="t('shell.background_tasks.title')"
        >
          <Icon
            :icon="ICONS.UI.PROGRESS_DOWNLOAD"
            :color="bgTasks.hasActiveTasks.value ? COLORS.WARNING : undefined"
            :size="sizeIcon"
          />
        </button>
      </template>

      <div class="bg-tasks">
        <div v-for="task in bgTasks.tasks.value" :key="task.id" class="bg-task">
          <div class="bg-task__main">
            <span class="bg-task__label">{{ t(task.label) }}</span>
            <template v-if="task.status === 'running'">
              <LjProgress :value="task.progress ?? 0" :indeterminate="!task.progress" :height="4" />
              <span class="bg-task__detail">
                {{ formatBackgroundTaskDetail(task.detail, t) || `${Math.round(task.progress)}%` }}
              </span>
            </template>
            <span v-else class="bg-task__detail">
              {{ t(`shell.background_tasks.${task.status}`) }}
            </span>
          </div>

          <LjButton
            v-if="task.status === 'running' && task._cancelFn"
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.CANCEL"
            :aria-label="t('shell.background_tasks.cancel')"
            @click="confirmCancel(task)"
          />
          <LjButton
            v-else
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.CLOSE"
            @click="bgTasks.dismissTask(task.id)"
          />
        </div>

        <p v-if="bgTasks.tasks.value.length === 0" class="bg-tasks__empty">
          {{ t("shell.background_tasks.empty") }}
        </p>
      </div>
    </LjPopover>

    <!--    Pesquisa Rápida-->
    <LjTooltip :text="$t('shell.quick_search')" side="bottom">
      <button type="button" class="shell-tool" @click="openCommandPalette">
        <Icon :icon="ICONS.ACTIONS.SEARCH" :size="sizeIcon" />
      </button>
    </LjTooltip>

    <!--    Pesquisa Bíblia-->
    <LjTooltip :text="$t('shell.bible_quick_search')" side="bottom">
      <button type="button" class="shell-tool" @click="openBibleSearch">
        <Icon :icon="ICONS.MODULES.BIBLE" :size="sizeIcon" />
      </button>
    </LjTooltip>

    <!--    Favoritos-->
    <LjTooltip :text="$t('ribbon.btn.favorites')" side="bottom">
      <button type="button" class="shell-tool" @click="openFavorites">
        <Icon :icon="ICONS.UI.STAR" :size="sizeIcon" />
      </button>
    </LjTooltip>

    <!--    Modo de cor-->
    <LjTooltip :text="$t('shell.toggle_theme')" side="bottom">
      <button type="button" class="shell-tool" @click="toggleTheme">
        <Icon :icon="isDark ? ICONS.UI.THEME_LIGHT : ICONS.UI.THEME_DARK" :size="sizeIcon" />
      </button>
    </LjTooltip>

    <!--    Sobre-->
    <LjTooltip :text="$t('shell.appmenu_items.about')" side="bottom">
      <button type="button" class="shell-tool" @click="openAbout">
        <Icon :icon="ICONS.UI.INFORMATION_OUTLINE" :size="sizeIcon" />
      </button>
    </LjTooltip>

    <!--    Hotkeys-->
    <LjTooltip :text="$t('hotkeys.title')" side="bottom">
      <button type="button" class="shell-tool" @click="openHotkeys">
        <Icon :icon="ICONS.UI.HELP" :size="sizeIcon" />
      </button>
    </LjTooltip>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useTheme } from "vuetify";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import $modules from "@/helpers/Modules";
import $alert from "@/helpers/Alert";
import { KEYS } from "@/constants/UserDataKeys";
import {
  openBackgroundProjectionWindows,
  closeBackgroundProjectionWindows,
} from "@/helpers/ProjectionWindows";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBackgroundTasks, type BackgroundTask } from "@/composables/useBackgroundTasks";
import { formatBackgroundTaskDetail } from "@/helpers/BackgroundTaskDetail";
import Icon from "@/components/Icon.vue";
import { LjButton, LjPopover, LjProgress, LjTooltip } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { COLORS } from "@constants/Colors";

const { t } = useI18n();
const vuetifyTheme = useTheme();
const bgTasks = useBackgroundTasks();

const isDark = computed(() => $appdata.get(KEYS.SHELL.IS_DARK, false));

const hasUpdate = computed(() => $appdata.get(KEYS.SHELL.APP_UPDATE_AVAILABLE, false));

const isBgPlaying = computed(() =>
  $userdata.get<boolean>(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, false)
);
const isLibrasEnabled = ref(localStorage.getItem("libras_enabled") === "true");

const sizeIcon = 16;

function openUpdates() {
  window.dispatchEvent(new CustomEvent("louvorja:open-updates"));
}

function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("louvorja:open-command-palette"));
}

function openBibleSearch() {
  window.dispatchEvent(new CustomEvent("louvorja:open-bible-search"));
}

function openFavorites() {
  $modules.open("favorites");
}

function toggleTheme() {
  try {
    const cur = vuetifyTheme.global.name.value || "darkblue";
    const lastLight = $userdata.get("theme_last_light", null);
    const next =
      cur === "dark"
        ? lastLight && lastLight !== "dark"
          ? lastLight
          : "darkblue"
        : ($userdata.set("theme_last_light", cur), "dark");
    vuetifyTheme.change(next);
    $userdata.set("theme", next);
    document.documentElement.dataset.theme = next;
    $appdata.set("is_dark", next === "dark");
  } catch (err) {
    console.error("[ShellTools] toggleTheme falhou:", err);
  }
}

function openAbout() {
  window.dispatchEvent(new CustomEvent("louvorja:open-about"));
}

function openHotkeys() {
  window.dispatchEvent(new CustomEvent("louvorja:open-hotkeys"));
}

async function toggleBackgroundProjection() {
  if (isBgPlaying.value) {
    $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, false);
    Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE, {});
    await closeBackgroundProjectionWindows();
  } else {
    $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, true);
    await openBackgroundProjectionWindows();
    const stored = localStorage.getItem("lj_background_projection");
    if (stored) {
      try {
        Broadcast.send(BROADCAST_TYPE.BACKGROUND_PROJECTION, JSON.parse(stored));
      } catch (_) {
        /* ignore */
      }
    }
  }
}

function confirmCancel(task: BackgroundTask): void {
  $alert.yesno(
    {
      title: t("shell.background_tasks.title"),
      text: t("shell.background_tasks.confirm_cancel"),
    },
    (btn?: string) => {
      if (btn === "yes") {
        bgTasks.cancelTask(task.id);
      }
    }
  );
}

function toggleLibras() {
  const next = !isLibrasEnabled.value;
  isLibrasEnabled.value = next;
  localStorage.setItem("libras_enabled", String(next));
  Broadcast.send(BROADCAST_TYPE.LIBRAS_TOGGLE, { enabled: next });
}

// Sincronizar estado quando outro componente altera o toggle
Broadcast.listen((msg: { type: string; payload: unknown }) => {
  if (msg.type === BROADCAST_TYPE.LIBRAS_TOGGLE) {
    const p = msg.payload as Record<string, unknown>;
    isLibrasEnabled.value = p?.enabled === true;
  }
});
</script>

<style scoped>
.shell-tools {
  display: flex;
  align-items: stretch;
}
.shell-tool {
  width: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  outline: none;
  font-family: inherit;
  opacity: 0.8;
  color: var(--lj-white);
  transition:
    background var(--lj-transition-fast),
    opacity var(--lj-transition-fast);
}
.shell-tool:hover {
  opacity: 1;
}

.shell-tool--update {
  opacity: 1;
  position: relative;
}

.shell-tool--update-icon {
  color: #ffb300;
  filter: drop-shadow(0 0 4px rgba(255, 179, 0, 0.6));
}
</style>

<!-- Sem `scoped`: este conteúdo é renderizado dentro do popover, que vai para
     um portal no <body> e não recebe o atributo de escopo. -->
<style>
.bg-tasks {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  min-width: 300px;
}

.bg-task {
  display: flex;
  align-items: flex-start;
  gap: var(--lj-space-3);
}

.bg-task__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

.bg-task__label {
  font-size: var(--lj-text-base);
  color: var(--lj-text);
}

.bg-task__detail {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-subtle);
}

.bg-tasks__empty {
  margin: 0;
  padding: var(--lj-space-4) 0;
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
  text-align: center;
}
</style>
