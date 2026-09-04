<template>
  <div class="app-menu-wrapper">
    <button
      ref="trigger"
      type="button"
      class="app-menu-btn"
      :class="{ 'app-menu-btn--open': open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="$t('shell.appmenu')"
      :title="$t('shell.appmenu')"
      @click="toggle"
    >
      <Icon :icon="ICONS.UI.OPTIONS" />
    </button>

    <Teleport to="body">
      <Transition name="app-menu">
        <div v-if="open" class="app-menu-overlay" @click.self="close">
          <div class="app-menu-panel" role="menu" :aria-label="$t('shell.appmenu')">
            <header class="app-menu-header" :class="{ 'app-menu-header--mac': isMac }">
              <button
                type="button"
                class="app-menu-back"
                :title="$t('alert.close')"
                :aria-label="$t('alert.close')"
                @click="close"
              >
                <v-icon :icon="ICONS.ACTIONS.CLOSE" size="20" />
              </button>
              <span class="app-menu-header-title">
                {{ activeItem?.label ? $t(activeItem.label) : $t("shell.appmenu") }}
              </span>
            </header>

            <div class="app-menu-body">
              <nav class="app-menu-sidebar">
                <button
                  v-for="item in items"
                  :key="item.id"
                  type="button"
                  class="app-menu-item"
                  :class="{ 'app-menu-item--active': activeItem?.id === item.id }"
                  :title="$t(item.label)"
                  role="menuitem"
                  @click="selectItem(item)"
                >
                  <Icon :icon="item.icon" class="mr-2" />
                  <span class="app-menu-item-label lj-u-truncate">{{ $t(item.label) }}</span>
                </button>
              </nav>

              <div class="app-menu-content">
                <Transition name="app-menu-screen" mode="out-in">
                  <div :key="activeItem?.id">
                    <!-- O Sobre abre com hero próprio e mantém o título da página;
                       nas demais telas ele repetiria o header do painel. -->
                    <h2 v-if="activeItem?.id === 'about'" class="app-menu-content-title">
                      {{ activeItem?.label ? $t(activeItem.label) : "" }}
                    </h2>

                    <!-- Painéis específicos por item -->
                    <AppMenuOpcoes v-if="activeItem?.id === 'settings'" :initial-tab="optionsTab" />
                    <AppMenuSobre v-else-if="activeItem?.id === 'about'" />
                    <AppMenuTransmitir v-else-if="activeItem?.id === 'transmission'" />
                    <AppMenuSincronizar v-else-if="activeItem?.id === 'sync'" />
                    <AppMenuAcessibilidade v-else-if="activeItem?.id === 'accessibility'" />
                    <AppMenuAtualizacoes v-else-if="activeItem?.id === 'updates'" />
                    <AppMenuImportExport v-else-if="activeItem?.id === 'import_export'" />
                    <AppMenuAlbums v-else-if="activeItem?.id === 'albums'" />
                    <AppMenuDev v-else-if="activeItem?.id === 'dev'" />

                    <p v-else class="app-menu-content-placeholder">
                      {{ $t("shell.appmenu_content_placeholder") }}
                    </p>
                  </div>
                </Transition>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import AppMenuOpcoes from "./AppMenuOpcoes.vue";
import AppMenuSobre from "./AppMenuSobre.vue";
import AppMenuTransmitir from "./AppMenuTransmitir.vue";
import AppMenuSincronizar from "./AppMenuSincronizar.vue";
import AppMenuAcessibilidade from "./AppMenuAcessibilidade.vue";
import AppMenuAtualizacoes from "./AppMenuAtualizacoes.vue";
import AppMenuImportExport from "./AppMenuImportExport.vue";
import AppMenuAlbums from "./AppMenuAlbums.vue";
import AppMenuDev from "./AppMenuDev.vue";
import Platform from "@/helpers/Platform";
import { ICONS } from "@/config/Icons";
import Icon from "@/components/Icon.vue";

// Detecta modo desenvolvimento — controla a visibilidade do item
// "Desenvolvedor" no menu (recursos de dev são ocultados em produção).
const isDev = Platform.isDev;

// Detecta macOS via Platform (Electron) ou navigator (web fallback) —
// usado para ajustar o header da AppMenu (não sobrepor traffic lights)
// e usar botão retangular em vez de circular.
const isMac = computed(() => {
  if (Platform.platform === "darwin") return true;
  if (typeof navigator !== "undefined") {
    const p = (navigator.platform || navigator.userAgent || "").toLowerCase();
    return p.includes("mac");
  }
  return false;
});

const open = ref(false);
const trigger = ref(null);
const activeItem = ref(null);

// Aba inicial da tela de Opções quando aberta programaticamente
// (ex: botão "Configurações" da ribbon da Liturgia → aba Slides).
const optionsTab = ref("general");

/**
 * Itens com `inline: true` são renderizados DENTRO do AppMenu
 * (em vez de fechar o menu e disparar uma ação).
 */
const items = computed(() => [
  {
    id: "about",
    label: "shell.appmenu_items.about",
    icon: ICONS.UI.INFORMATION_OUTLINE,
    inline: true,
  },
  {
    id: "settings",
    label: "shell.appmenu_items.settings",
    icon: ICONS.UI.OPTIONS,
    inline: true,
  },
  {
    id: "transmission",
    label: "shell.appmenu_items.transmission",
    icon: ICONS.UI.SERVER,
    inline: true,
  },
  {
    id: "import_export",
    label: "shell.appmenu_items.import_export",
    icon: ICONS.UI.IMPORT_EXPORT,
    inline: true,
  },
  {
    id: "sync",
    label: "shell.appmenu_items.sync",
    icon: ICONS.UI.SYNC_CLOUD,
    inline: true,
  },
  {
    id: "accessibility",
    label: "shell.appmenu_items.accessibility",
    icon: ICONS.UI.ACCESSIBILITY,
    inline: true,
  },
  {
    id: "updates",
    label: "shell.appmenu_items.check_update",
    icon: ICONS.UI.CHECK_UPDATE,
    inline: true,
  },
  {
    id: "albums",
    label: "shell.appmenu_items.albums",
    icon: ICONS.MUSIC.OFF,
    inline: true,
  },
  ...(isDev
    ? [
        {
          id: "dev",
          label: "shell.appmenu_items.dev",
          icon: ICONS.UI.DEV,
          inline: true,
        },
      ]
    : []),
  {
    id: "feedback",
    label: "shell.appmenu_items.feedback",
    icon: ICONS.UI.FEEDBACK,
    action: openFeedback,
  },
  {
    id: "donate",
    label: "shell.appmenu_items.donate",
    icon: ICONS.UI.DONATE,
    action: openDonation,
  },
  {
    id: "exit",
    label: "shell.appmenu_items.exit",
    icon: ICONS.UI.INFORMATION_OUTLINE,
    action: exitApp,
  },
]);

function toggle() {
  if (open.value) close();
  else openMenu();
}

function openMenu() {
  open.value = true;
  optionsTab.value = "general";
  activeItem.value = items.value.find((i) => i.id === "settings") || items.value[0];
  document.addEventListener("keydown", onKeydown);
}

/**
 * Abre o AppMenu já na tela de um item específico (ex: "updates").
 * Usado pela snackbar de atualização e pelo ícone da ShellTools.
 */
function openAt(itemId) {
  open.value = true;
  activeItem.value = items.value.find((i) => i.id === itemId) || items.value[0];
  document.addEventListener("keydown", onKeydown);
}

function close() {
  open.value = false;
  document.removeEventListener("keydown", onKeydown);
}

function onKeydown(e) {
  if (e.key === "Escape") close();
}

function selectItem(item) {
  activeItem.value = item;
  if (item.inline) return; // Renderiza dentro do menu, não fecha
  close();
  setTimeout(() => {
    try {
      item.action?.();
    } catch (err) {
      console.error(err);
    }
  }, 0);
}

function openFeedback() {
  if (typeof window !== "undefined") {
    window.open("https://github.com/louvorja/violin-app/issues", "_blank", "noopener,noreferrer");
  }
}

function openDonation() {
  if (typeof window !== "undefined") {
    window.open("https://www.louvorja.com.br/doacao", "_blank", "noopener,noreferrer");
  }
}

function exitApp() {
  if (typeof window === "undefined") return;
  if (window.louvorjaApi?.window?.close) window.louvorjaApi.window.close();
  else window.close();
}

onMounted(() => {
  window.addEventListener("louvorja:open-updates", onOpenUpdates);
  window.addEventListener("louvorja:open-options", onOpenOptions);
  window.addEventListener("louvorja:open-about", onOpenAbout);
});

onBeforeUnmount(() => {
  window.removeEventListener("louvorja:open-updates", onOpenUpdates);
  window.removeEventListener("louvorja:open-options", onOpenOptions);
  window.removeEventListener("louvorja:open-about", onOpenAbout);
  document.removeEventListener("keydown", onKeydown);
});

function onOpenUpdates() {
  openAt("updates");
}

function onOpenAbout() {
  openAt("about");
}

/**
 * Abre o AppMenu na tela de Opções já na aba indicada (ex: "slides").
 * Disparado pela ribbon da Liturgia (e possivelmente outros módulos).
 */
function onOpenOptions(e) {
  optionsTab.value = e?.detail?.tab || "general";
  openAt("settings");
}
</script>

<style scoped>
.app-menu-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

/* Botão "9 quadrados" */
.app-menu-btn {
  width: var(--lj-appmenu-width);
  height: 100%;
  min-height: var(--lj-tab-height);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: var(--lj-tabs-bg);
  color: var(--lj-white);
  cursor: pointer;
  user-select: none;
  transition: background var(--lj-transition-fast);
  outline: none;
}

.app-menu-btn:hover {
  background: var(--lj-navy-active);
}

.app-menu-btn--open {
  background: var(--lj-navy-darker);
}

/* Painel fullscreen */
.app-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: var(--lj-black-alpha-40);
  font-family: var(--lj-font-shell);
}

.app-menu-panel {
  position: absolute;
  inset: 0;
  background: var(--lj-surface-bg);
  display: flex;
  flex-direction: column;
  color: var(--lj-text);
}

.app-menu-header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  height: 56px;
  padding: 0 var(--lj-space-6);
  background: var(--lj-tabs-bg);
  color: var(--lj-white);
  flex-shrink: 0;
}

/* macOS: traffic lights ocupam ~78px do canto superior esquerdo.
   Empurra o conteúdo do header pra direita pra não sobrepor. */
.app-menu-header--mac {
  padding-left: 88px;
}

.app-menu-back {
  min-width: 30px;
  width: 30px;
  height: 30px;
  /* Botão nativo, não v-btn: o `padding: 0 16px` do Vuetify brigava com a
     largura fixa e deixava o quadrado em 32×30, e o ripple do Material não
     combina com o resto da barra. */
  padding: 0;
  cursor: pointer;
  /* Em % o raio vira elipse (10% da largura × 10% da altura). */
  border-radius: var(--lj-radius-sm);
  border: none;
  background: var(--lj-navy-active);
  color: var(--lj-white);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--lj-transition-fast);
  font-family: inherit;
}

.app-menu-back:hover {
  background: var(--lj-white-alpha-25);
}

.app-menu-header-title {
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-regular);
  letter-spacing: 0.02em;
}

.app-menu-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.app-menu-sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--lj-appmenu-sidebar-bg);
  display: flex;
  flex-direction: column;
  padding: var(--lj-space-3) 0;
  overflow-y: auto;
}

.app-menu-item {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 var(--lj-space-7);
  background: transparent;
  border: none;
  color: var(--lj-appmenu-sidebar-color);
  cursor: pointer;
  text-align: left;
  font-size: var(--lj-text-base);
  font-family: inherit;
  transition:
    background var(--lj-transition-fast),
    color var(--lj-transition-fast);
  outline: none;
}

.app-menu-item:hover {
  background: var(--lj-appmenu-sidebar-hover-bg);
  color: var(--lj-white);
}

.app-menu-item.app-menu-item--active {
  background: var(--lj-appmenu-sidebar-active-bg);
  color: var(--lj-appmenu-sidebar-active-color);
}

.app-menu-content {
  flex: 1;
  padding: var(--lj-space-6) var(--lj-space-8) var(--lj-space-8);
  overflow-y: auto;
  background: var(--lj-surface-bg);
}

.app-menu-content-title {
  font-size: var(--lj-text-2xl);
  font-weight: var(--lj-weight-regular);
  margin: 0 0 var(--lj-space-6);
  color: var(--lj-text);
  letter-spacing: -0.01em;
}

.app-menu-content-placeholder {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
  margin: var(--lj-space-6) 0;
}

/* Abertura do painel: o backdrop dissolve e a superfície sobe um pouco.
   Trocar de tela é só um fade — deslizar sugeriria navegação lateral. */
.app-menu-enter-active,
.app-menu-leave-active {
  transition: opacity var(--lj-transition-normal);
}

.app-menu-enter-active .app-menu-panel,
.app-menu-leave-active .app-menu-panel {
  transition:
    opacity var(--lj-transition-normal),
    transform 0.2s var(--lj-ease-out);
}

.app-menu-enter-from,
.app-menu-leave-to {
  opacity: 0;
}

.app-menu-enter-from .app-menu-panel,
.app-menu-leave-to .app-menu-panel {
  opacity: 0;
  transform: translateY(8px);
}

.app-menu-screen-enter-active,
.app-menu-screen-leave-active {
  transition: opacity var(--lj-transition-fast);
}

.app-menu-screen-enter-from,
.app-menu-screen-leave-to {
  opacity: 0;
}

/* Janela estreita: a barra lateral vira uma coluna de ícones para devolver
   largura ao conteúdo. */
@media (max-width: 820px) {
  .app-menu-sidebar {
    width: 56px;
  }

  .app-menu-item {
    justify-content: center;
    padding: 0;
  }

  .app-menu-item-label {
    display: none;
  }

  .app-menu-item :deep(.mr-2) {
    margin-right: 0 !important;
  }
}

@media (max-width: 560px) {
  .app-menu-content {
    padding: var(--lj-space-5) var(--lj-space-6) var(--lj-space-6);
  }

  .app-menu-header {
    padding: 0 var(--lj-space-5);
    gap: var(--lj-space-4);
  }
}

.app-menu-footer {
  border-top: 1px solid var(--lj-divider);
  padding: var(--lj-space-3) var(--lj-space-6);
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
  text-align: right;
  background: var(--lj-surface-bg-soft);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>
