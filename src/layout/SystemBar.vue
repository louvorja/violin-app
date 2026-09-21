<template>
  <div
    v-if="isDesktop"
    class="systembar"
    :class="{ 'systembar--mac': isMac, 'systembar--overlay': !isMac }"
    @dblclick="toggleMaximize"
  >
    <!-- AppMenu + Abas (no-drag) -->
    <div class="systembar-left">
      <AppMenu class="systembar-appmenu" />
      <RibbonTabs id-prefix="systembar" class="systembar-tabs" />
    </div>

    <!-- Título + logo (drag) -->
    <div class="systembar-drag">
      <LjLogo :size="16" class="systembar-logo" />
      <span class="systembar-title">{{ title }}</span>
    </div>

    <!-- Ferramentas (no-drag) -->
    <div class="systembar-tools" :class="isLinux || isWindows ? 'systembar-tools--win' : ''">
      <ShellTools />
    </div>

    <!-- Os botões de janela são do sistema (semáforos no macOS, titleBarOverlay
         no Windows/Linux): não há markup deles aqui, só o espaço reservado. -->
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Platform from "@/helpers/Platform";
import $appdata from "@/helpers/AppData";
import LjLogo from "@/components/LjLogo.vue";
import ShellTools from "@/layout/shell/ShellTools.vue";
import AppMenu from "@/layout/shell/AppMenu.vue";
import RibbonTabs from "@/components/RibbonTabs.vue";
import { useRibbonStore } from "@/stores/ribbonStore";

const { t } = useI18n();
const store = useRibbonStore();

const isDesktop = computed(() => $appdata.get("is_desktop"));
const isMac = computed(() => Platform.platform === "darwin");
const isWindows = computed(() => Platform.platform === "win32");
const isLinux = computed(() => Platform.platform === "linux");

const activeModuleId = computed(() => {
  const activeId = $appdata.get("active_module");
  if (activeId) return activeId;
  const modules = $appdata.get("modules") || {};
  const skip = new Set(["media", "lyric", "album"]);
  const ids = Object.keys(modules).reverse();
  for (const id of ids) {
    if (skip.has(id)) continue;
    if (modules[id]?.show === true) return id;
  }
  return null;
});

const title = computed(() => {
  if (!activeModuleId.value) return "Louvor JA Violin";
  const key = `modules.${activeModuleId.value}.title`;
  const translated = t(key);
  const moduleTitle = translated === key ? activeModuleId.value.replace(/_/g, " ") : translated;
  return `${moduleTitle} - Louvor JA Violin`;
});

function toggleMaximize() {
  Platform.window?.toggleMaximize();
}
</script>

<style scoped>
.systembar {
  display: flex;
  align-items: stretch;
  height: var(--lj-systembar-height);
  background: var(--lj-titlebar-bg);
  color: var(--lj-titlebar-color);
  font-size: var(--lj-text-base);
  user-select: none;
  flex-shrink: 0;
  -webkit-app-region: drag;
  font-family: var(--lj-font-shell);
}

/* ── Left: AppMenu + tabs (no-drag) ── */
.systembar-left {
  display: flex;
  align-items: stretch;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.systembar--mac {
  padding-left: 80px;
}

/* Win/Linux: os botões do sistema flutuam sobre o canto direito. A variável
   `titlebar-area-width` é a largura que sobra à esquerda deles; o fallback
   (3 × 46px, os botões do Windows) vale se o ambiente não a expuser. */
.systembar--overlay {
  padding-right: calc(
    100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 138px))
  );
}

.systembar-appmenu {
  height: 100%;
}

/* ── Center: title + logo (drag) ── */
.systembar-drag {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  padding: 0 var(--lj-space-5);
  overflow: hidden;
  white-space: nowrap;
  -webkit-app-region: drag;
}

.systembar-logo {
  flex-shrink: 0;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
  opacity: 0.9;
}

.systembar-title {
  font-weight: var(--lj-weight-medium);
  letter-spacing: 0.02em;
  opacity: 0.95;
}

/* ── Right: tools (no-drag) ── */
.systembar-tools {
  display: flex;
  align-items: stretch;
  -webkit-app-region: no-drag;
}

.systembar-tools--win {
  padding-right: var(--lj-space-5);
}

.systembar-tools .shell-tool {
  height: var(--lj-systembar-height);
  color: var(--lj-white);
}
.systembar-tools .shell-tool:hover {
  background: var(--lj-white-alpha-18);
}
</style>
