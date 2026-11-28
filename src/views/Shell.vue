<template>
  <div
    class="shell-root"
    :class="{ 'shell-fading-in': !ready, 'shell-root--web': !Platform.isDesktop }"
  >
    <AppSystemBar />

    <RibbonBar />

    <!-- PageControl interno (tabs dos módulos abertos) -->
    <OpenModulesTabs v-show="!isShellExpanded" />

    <PwaUpdateNotice v-if="!Platform.isDesktop" />

    <main class="shell-main">
      <div class="shell-grid" :class="{ 'shell-grid--with-sidebar': showLiturgySidebar }">
        <Transition name="chat-drawer-slide">
          <ChatDrawer v-if="Platform.isDesktop && (isChatOpen || isPinned)" />
        </Transition>

        <div
          class="shell-center"
          :class="{
            'shell-content--desktop-download': showDesktopDownload,
            'shell-center--drawer-pinned': isPinned && isChatOpen,
          }"
        >
          <div
            class="shell-content"
            :class="{
              'shell-content--desktop-download': showDesktopDownload,
              'shell-content--has-module': moduleCoversBackground,
            }"
          >
            <AppAlert />
            <AppSnackbar />
            <DesktopDownloadPrompt v-if="showDesktopDownload" />
            <HomeStart v-if="showHome" />
            <AppModules />
          </div>
        </div>

        <!-- O painel lateral aparece nos demais módulos conforme a preferência do
             usuário; some com o módulo Liturgia aberto (duplicaria) e com o Modo
             apresentação aberto, cujo programa do culto substitui o painel. -->
        <ShellLiturgyPanel v-if="showLiturgySidebar" class="shell-sidebar" />
      </div>
    </main>

    <AppFooter v-show="!hideFooterPlayer" />
    <OpeningBar />

    <CommandPalette v-if="cmdPaletteOpen" v-model="cmdPaletteOpen" />
    <MusicSpotlight v-if="musicSearchOpen" v-model="musicSearchOpen" />
    <BibleSpotlight v-if="bibleSearchOpen" v-model="bibleSearchOpen" />
    <HotkeysCheatsheet v-if="hotkeysOpen" v-model="hotkeysOpen" />
    <StartupTipDialog
      v-if="startupTipOpen && startupTip"
      v-model="startupTipOpen"
      :tip="startupTip"
      :show-previous="startupTipHistory.length > 1"
      :previous-disabled="startupTipHistoryIndex === 0"
      :next-disabled="startupNextDisabled"
      @previous="showPreviousStartupTip"
      @next="showNextStartupTip"
    />
    <ReleaseNotesDialog
      v-if="releaseNotesOpen"
      v-model="releaseNotesOpen"
      :release="releaseNotes"
      @close="onReleaseNotesClose"
    />
    <StorageSetupDialog v-if="storageSetupOpen" @complete="onStorageSetupComplete" />
    <StartupCheckDialog
      v-if="startupCheckOpen && storageReady"
      v-model="startupCheckOpen"
      :source="startupCheckSource"
    />
    <InstallAppDialog v-if="installDialogOpen" v-model="installDialogOpen" />
    <UpdateAvailableDialog
      v-if="updateDialogOpen"
      v-model="updateDialogOpen"
      :version="updateDialogVersion"
      @start-download="onUpdateDialogDownload"
      @close="onUpdateDialogClose"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";

import { LjButton } from "@/components/ui";
import AppSystemBar from "@/layout/SystemBar.vue";
import AppFooter from "@/layout/Footer.vue";
import OpeningBar from "@/components/OpeningBar.vue";
import AppModules from "@/layout/Modules.vue";
import AppAlert from "@/layout/Alert.vue";
import AppSnackbar from "@/layout/SnackbarBar.vue";
import $snackbar from "@/helpers/Snackbar";
const CommandPalette = defineAsyncComponent(() => import("@/layout/shell/CommandPalette.vue"));
const MusicSpotlight = defineAsyncComponent(() => import("@components/MusicSpotlight.vue"));
const BibleSpotlight = defineAsyncComponent(() => import("@components/BibleSpotlight.vue"));
import RibbonBar from "@/layout/shell/RibbonBar.vue";
import OpenModulesTabs from "@/layout/shell/OpenModulesTabs.vue";
import PwaUpdateNotice from "@/layout/shell/PwaUpdateNotice.vue";
import ShellLiturgyPanel from "@/layout/shell/ShellLiturgyPanel.vue";
import { liturgySidebarDefault } from "@/helpers/LiturgySidebar";
const HotkeysCheatsheet = defineAsyncComponent(
  () => import("@/layout/shell/HotkeysCheatsheet.vue")
);
const StartupTipDialog = defineAsyncComponent(() => import("@/components/StartupTipDialog.vue"));
const InstallAppDialog = defineAsyncComponent(() => import("@/components/InstallAppDialog.vue"));
const StartupCheckDialog = defineAsyncComponent(
  () => import("@/components/StartupCheckDialog.vue")
);
const StorageSetupDialog = defineAsyncComponent(
  () => import("@/components/StorageSetupDialog.vue")
);
const ReleaseNotesDialog = defineAsyncComponent(
  () => import("@/components/ReleaseNotesDialog.vue")
);
import type { ReleaseNotes } from "@/types/Update";
import { shouldShowReleaseNotes } from "@/helpers/ReleaseNotesPolicy";
const UpdateAvailableDialog = defineAsyncComponent(
  () => import("@/components/UpdateAvailableDialog.vue")
);
import DesktopDownloadPrompt from "@/components/DesktopDownloadPrompt.vue";
import HomeStart from "@/layout/shell/HomeStart.vue";
import packageJson from "@root/package.json";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import {
  autoDownloadUpdatesEnabled,
  createUpdateOutcomeTracker,
  startupActionForAvailableUpdate,
} from "@/helpers/AppUpdatePrompt";
import { ICONS } from "@/config/Icons";
import { KEYS } from "@/constants/UserDataKeys";
import { anyOpenModuleWants, moduleShell } from "@/config/modules";
import $popup from "@/helpers/Popup";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { buildStartupTips, type StartupTip } from "@/helpers/StartupTips";

import { registerShell } from "@/composables/useShell";
import { useAppTheme } from "@/composables/useAppTheme";
import { useViewport } from "@/composables/useViewport";
import { useShellExpanded } from "@/composables/useModuleExpanded";
import { useProjectionShutdown } from "@/composables/useProjectionShutdown";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import { awaitingModule, shownModuleId } from "@/composables/useModuleSwap";
import { hasOpenWebWindows } from "@/helpers/projection/webWindow";
import { open as openProjection } from "@/helpers/Projection";
import { useSyncManager } from "@/composables/useSyncManager";
import { reportUnfinishedRuns } from "@/helpers/DownloadTelemetry";
import { useAppInstall } from "@/composables/useAppInstall";
import { shouldAutoInstallCatalog } from "@/helpers/CatalogAutoInstall";
const ChatDrawer = defineAsyncComponent(() => import("@/components/ChatDrawer.vue"));
import { useChat } from "@/composables/useChat";
import ScheduledStore from "@/helpers/ScheduledStore";

const { locale, t } = useI18n();
const { applyStoredTheme } = useAppTheme();
const { platform, width } = useViewport();
const bgTasks = useBackgroundTasks();
const sync = useSyncManager();
const { toggleOpen: toggleChat, isPinned, isOpen: isChatOpen } = useChat();

const cmdPaletteOpen = ref(false);
const musicSearchOpen = ref(false);
const bibleSearchOpen = ref(false);
const hotkeysOpen = ref(false);
const startupTipOpen = ref(false);
const startupTips = ref<StartupTip[]>([]);
const startupTipHistory = ref<StartupTip[]>([]);
const startupTipHistoryIndex = ref(0);
const startupTipSeen = ref<Set<string>>(new Set());
const startupTip = computed(() => startupTipHistory.value[startupTipHistoryIndex.value] ?? null);
const startupNextDisabled = computed(() =>
  startupTips.value.every((tip) => startupTipSeen.value.has(tip.id))
);
const startupCheckOpen = ref(false);
/** De onde a verificação inicial foi aberta, para a telemetria separar o boot do menu. */
const startupCheckSource = ref<"boot" | "menu">("boot");
const storageSetupOpen = ref(false);
const storageReady = ref(!Platform.isDesktop);
let storageSetupPromise: Promise<void> | null = null;
let finishStorageSetup: (() => void) | null = null;

function onStorageSetupComplete(): void {
  storageSetupOpen.value = false;
  storageReady.value = true;
  finishStorageSetup?.();
  finishStorageSetup = null;
  autoInstallCatalog();
}

/** A primeira escolha das pastas acontece antes de qualquer download de boot. */
function ensureStorageSetup(): Promise<void> {
  if (storageReady.value) return Promise.resolve();
  if (storageSetupPromise) return storageSetupPromise;
  storageSetupPromise = (async () => {
    try {
      const locations = await Platform.api?.storage.locations();
      if (locations?.setupCompleted && !locations.pending && !locations.restartRequired) {
        storageReady.value = true;
        autoInstallCatalog();
        return;
      }
    } catch (error) {
      // A própria tela permite tentar ler novamente. Não prosseguir com
      // downloads em um caminho que ainda não pudemos verificar.
      console.warn("[Shell] storage setup falhou:", error);
    }
    storageSetupOpen.value = true;
    await new Promise<void>((resolve) => {
      finishStorageSetup = resolve;
    });
  })();
  return storageSetupPromise;
}
const releaseNotesOpen = ref(false);
const releaseNotes = ref<ReleaseNotes | null>(null);
const updateDialogOpen = ref(false);
const updateDialogVersion = ref("");
const ready = ref(false);
const {
  channel: installChannel,
  dialogOpen: installDialogOpen,
  installed: appInstalled,
} = useAppInstall();

// App instalado: o catálogo desce sozinho no primeiro uso com internet, para as
// listas e o modo offline não dependerem de abrir Sincronizar antes. No desktop,
// começa assim que o armazenamento estiver pronto, mesmo com o diálogo oculto.
// No PWA, espera o boot assentar antes de gravar os registros no IndexedDB.
// `ensureCatalogBundle` não baixa nada quando o catálogo já está instalado.
const CATALOG_AUTO_INSTALL_DELAY_MS = Platform.isDesktop ? 0 : 8000;
let catalogAutoInstallTimer: ReturnType<typeof setTimeout> | null = null;
let catalogAutoInstallArmed = false;
const shellOnline = () => $appdata.get<boolean>(KEYS.SHELL.IS_ONLINE, true) !== false;

function autoInstallCatalog(): void {
  if (!catalogAutoInstallArmed || !storageReady.value) return;
  // Atualizou o app: renova o catálogo guardado (em qualquer plataforma).
  if (shellOnline()) void sync.refreshCatalogAfterUpdate();
  const context = {
    desktop: Platform.isDesktop,
    installed: appInstalled.value,
    online: shellOnline(),
  };
  if (shouldAutoInstallCatalog(context)) void sync.ensureCatalogBundle();
}

watch([shellOnline, appInstalled], autoInstallCatalog);
// Um app que ficou aberto/offline por dias também verifica ao voltar ao uso.
const checkCatalogOnForeground = () => {
  if (document.visibilityState === "visible") autoInstallCatalog();
};
onMounted(() => document.addEventListener("visibilitychange", checkCatalogOnForeground));
onBeforeUnmount(() => document.removeEventListener("visibilitychange", checkCatalogOnForeground));

// A tela inicial sai quando o módulo aparece, não quando é pedido. O primeiro
// módulo aberto a partir daqui ainda precisa baixar o próprio código, e tirar a
// tela inicial já no clique deixava o fundo do tema sozinho por alguns quadros
// (composables/useModuleSwap.ts).
const noModuleOnScreen = computed(
  () => !$appdata.get<string | null>("active_module", null) || awaitingModule.value
);

// Com um módulo desenhado, o que fica atrás dele tem a cor dele — não a do
// tema. O módulo cobre a área inteira, então isso só aparece se algum quadro
// escapar sem módulo (remontagem, falha de carga), e aí não pisca cor nenhuma.
const moduleCoversBackground = computed(
  () => shownModuleId.value !== null && !awaitingModule.value
);

const showDesktopDownload = computed(() => {
  return installChannel.value === "desktop" && width.value >= 720 && noModuleOnScreen.value;
});

const showHome = computed(
  () =>
    !showDesktopDownload.value &&
    noModuleOnScreen.value &&
    $appdata.get<boolean>("import_modules", false)
);

const liturgyModuleOpen = computed(() => {
  return $appdata.get<boolean>(KEYS.MODULES.LITURGY.SHOW, false) === true;
});

const showLiturgySidebar = computed(
  () =>
    !liturgyModuleOpen.value &&
    !anyOpenModuleWants("hidesLiturgySidebar") &&
    $userdata.get<boolean>(KEYS.SHELL.LITURGY_VISIBLE, liturgySidebarDefault()) !== false
);

const { activeModule, isExpanded: isShellExpanded } = useShellExpanded();

// Módulo com os próprios controles da música e do vídeo no ar: o mini-player
// do rodapé seria um segundo painel dos mesmos botões.
const hideFooterPlayer = computed(() => moduleShell(activeModule.value).hidesFooterPlayer === true);

useProjectionShutdown();

// Listeners externos (eventos globais que substituem acoplamento direto via shell._ref)
const onOpenCommandPalette = () => {
  cmdPaletteOpen.value = true;
};
const onOpenHotkeys = () => {
  hotkeysOpen.value = true;
};
const onOpenMusicSearch = () => {
  musicSearchOpen.value = true;
};
const onOpenBibleSearch = () => {
  bibleSearchOpen.value = true;
};
const onOpenStartupCheck = async () => {
  await ensureStorageSetup();
  startupCheckSource.value = "menu";
  startupCheckOpen.value = true;
};

let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

/**
 * pagehide garante que escritas pendentes no ScheduledStore (itens agendados)
 * sejam flushadas antes do unload. Diferente de beforeunload, funciona sem
 * cancelar o close no Electron e o browser mantém a página viva até as
 * Promises resolverem (dentro do limite de tempo do browser).
 */
function onPageHide() {
  void ScheduledStore.flush();
}

/**
 * Só vale avisar antes de recarregar quando o reload destrói algo em curso:
 * uma janela de projeção aberta (o handle morre e a tela apaga no meio do
 * culto), mídia tocando ou download em segundo plano. Fora disso o prompt do
 * navegador aparece em toda troca de aba e o usuário aprende a ignorá-lo.
 *
 * Síncrona: `beforeunload` não espera promessa.
 */
function _hasWorkInProgress(): boolean {
  if (hasOpenWebWindows()) return true;
  if ($appdata.get(KEYS.MODULES.MEDIA.IS_PLAYING, false)) return true;
  return bgTasks.hasActiveTasks.value;
}

let messageHandler: ((event: MessageEvent) => void) | null = null;
let clockBootTimer: ReturnType<typeof setTimeout> | null = null;
let clockBootAttempted = false;

/** Abre o relógio em uma janela independente quando o operador optou por isso. */
function openClockProjectionOnBoot(): void {
  if (clockBootAttempted || !Platform.isDesktop) return;
  clockBootAttempted = true;
  if (!$userdata.get<boolean>(KEYS.OPTIONS.CLOCK_PROJECTION_ON_BOOT, false)) return;

  // Aguarda o primeiro frame da shell para não competir com o carregamento da
  // janela principal. A rota /clock tem seu próprio timer, então a projeção
  // continua viva mesmo quando a janela principal for minimizada.
  clockBootTimer = setTimeout(() => {
    clockBootTimer = null;
    void openProjection({
      feature: "clock_fullscreen",
      route: "/clock",
      fullscreen: true,
    })
      .then(() => {
        console.info("[Shell] projeção do relógio aberta no boot");
      })
      .catch((error) => {
        console.warn("[Shell] falha ao abrir projeção do relógio no boot:", error);
      });
  }, 250);
}

// ---------------------------------------------------------------------------
// Auto-update (D8): verificação ao iniciar + badge na ShellTools
// ---------------------------------------------------------------------------
// Quando "Verificar novas versões ao iniciar" está ativo, o app checa no boot.
// Se houver versão nova: snackbar clicável + flag app_update_available (ícone
// na ShellTools). Se "baixar automaticamente" estiver ativo, o main baixa em
// background e o estado "downloaded" também acende o ícone.
// ---------------------------------------------------------------------------
let _updaterUnsub: (() => void) | null = null;
let _displaysUnsub: (() => void) | null = null;

/**
 * Avisa o operador quando um monitor cai ou volta.
 *
 * O snackbar só existe nesta janela — as de projeção não montam o componente —
 * então é aqui que o evento vira aviso visível.
 */
function _handleDisplaysChanged(payload: { hidden?: string[]; shown?: string[] } | null): void {
  if (!payload) return;
  if (payload.hidden?.length) {
    $snackbar.warning(t("options.monitors.disconnected"));
  } else if (payload.shown?.length) {
    $snackbar.success(t("options.monitors.reconnected"));
  }
}
let _startupCheckPending = false;
let _pendingReleaseNotes = false;
let _releaseNotesPromise: Promise<ReleaseNotes | null> | null = null;
let _startupCheckTimeout: ReturnType<typeof setTimeout> | null = null;
let _bootPhase: "idle" | "release-notes" | "startup" | "done" = "idle";
let _startupCloseDeferred = false;
let _startupTipShown = false;

/** Encerra o encadeamento de diálogos do boot e mostra a dica de abertura. */
function _finishBootFlow(): void {
  _bootPhase = "done";
  if (_startupTipShown) return;
  _startupTipShown = true;
  // O modal bloqueia os fluxos E2E que existiam antes das dicas.
  if (import.meta.env.VITE_E2E === "1") return;
  if ($userdata.get<boolean>(KEYS.OPTIONS.SHOW_STARTUP_TIPS, true) === false) return;
  const tips = buildStartupTips();
  if (tips.length === 0) return;
  const first = tips[Math.floor(Math.random() * tips.length)];
  startupTips.value = tips;
  startupTipHistory.value = [first];
  startupTipHistoryIndex.value = 0;
  startupTipSeen.value = new Set([first.id]);
  startupTipOpen.value = true;
}

function showPreviousStartupTip(): void {
  if (startupTipHistoryIndex.value > 0) startupTipHistoryIndex.value -= 1;
}

function showNextStartupTip(): void {
  const unseen = startupTips.value.filter((tip) => !startupTipSeen.value.has(tip.id));
  if (unseen.length === 0) return;
  const next = unseen[Math.floor(Math.random() * unseen.length)];

  // A nova dica nasce do ponto atual; o que estava à frente vira histórico
  // abandonado, mas continua marcado como já exibido.
  startupTipHistory.value = startupTipHistory.value.slice(0, startupTipHistoryIndex.value + 1);
  startupTipHistory.value.push(next);
  startupTipHistoryIndex.value = startupTipHistory.value.length - 1;
  startupTipSeen.value = new Set([...startupTipSeen.value, next.id]);
}

watch(startupCheckOpen, (isOpen, wasOpen) => {
  if (!wasOpen || isOpen || _bootPhase !== "startup") return;
  if (sync.downloading.value || sync.bibleDownloading.value) {
    _startupCloseDeferred = true;
    return;
  }
  _startupCloseDeferred = false;
  _finishBootFlow();
});

watch(
  [() => sync.downloading.value, () => sync.bibleDownloading.value],
  ([downloading, bibleDownloading]) => {
    if (_bootPhase !== "startup" || !_startupCloseDeferred) return;
    if (downloading || bibleDownloading) return;
    _startupCloseDeferred = false;
    _finishBootFlow();
  }
);

function _openUpdatesScreen() {
  window.dispatchEvent(new CustomEvent("louvorja:open-updates"));
}

// Mostra as notas da versão, se houver o que mostrar. O conteúdo vem da API do
// GitHub: abrir o diálogo antes de tê-lo em mãos dava um modal de erro no boot
// de quem está sem internet — e o operador está offline justamente no culto.
async function _showPendingReleaseNotes(): Promise<boolean> {
  if (!_pendingReleaseNotes) return false;
  _pendingReleaseNotes = false;
  const data = await _releaseNotesPromise;
  if (!data) return false;
  releaseNotes.value = data;
  _bootPhase = "release-notes";
  releaseNotesOpen.value = true;
  return true;
}

async function _continueBootAfterUpdate(): Promise<void> {
  await ensureStorageSetup();
  _startupCheckPending = false;
  if (_startupCheckTimeout) {
    clearTimeout(_startupCheckTimeout);
    _startupCheckTimeout = null;
  }

  const shown = await _showPendingReleaseNotes();
  if (!shown) {
    void _showPendingStartupCheck();
  }
}

async function _showPendingStartupCheck() {
  if (!Platform.isDesktop) {
    _finishBootFlow();
    return;
  }
  await ensureStorageSetup();

  // Em desenvolvimento a verificação roda a cada recarga do Vite e prende o boot
  // num diálogo modal que só diz respeito à instalação do usuário final.
  const skip =
    Platform.isDev ||
    $userdata.get<boolean>(KEYS.OPTIONS.SKIP_STARTUP_CHECK, false) ||
    $userdata.get<boolean>(KEYS.OPTIONS.STARTUP_CHECK_DONE, false);
  if (skip) {
    _finishBootFlow();
    return;
  }

  _bootPhase = "startup";
  // Marcado na abertura, não no fechamento: se o scan travar, quem fecha o app
  // não pode ser condenado a rever este diálogo em toda inicialização. Quem
  // quiser revê-lo tem o botão em Sincronizar.
  $userdata.set(KEYS.OPTIONS.STARTUP_CHECK_DONE, true);
  startupCheckSource.value = "boot";
  startupCheckOpen.value = true;
}

// Desfecho de cada download (pronto para instalar / falhou), qualquer que seja
// o caminho: automático, pelo aviso ou pelas Opções.
const _trackUpdateOutcome = createUpdateOutcomeTracker((event, properties) =>
  Telemetry.track(event, properties)
);

// O aviso desta abertura já teve resposta? Fechar depois de "Atualizar agora"
// não pode contar também como "Depois".
let _updatePromptAnswered = false;

function _autoDownloadUpdates(): boolean {
  return autoDownloadUpdatesEnabled($userdata.get(KEYS.OPTIONS.AUTO_DOWNLOAD_UPDATES, null));
}

function _openUpdatePrompt(
  version: string,
  stage: "available" | "downloaded",
  requiresElevation: boolean
) {
  updateDialogVersion.value = version;
  updateDialogOpen.value = true;
  _updatePromptAnswered = false;
  Telemetry.track("app_update_prompt_shown", {
    version,
    stage,
    install_requires_elevation: requiresElevation,
  });
}

function _handleUpdaterState(
  state: {
    status: string;
    newVersion?: string | null;
    progress?: number;
    error?: string | null;
    errorKind?: string | null;
    installRequiresElevation?: boolean;
  } | null
) {
  if (!state) return;
  _trackUpdateOutcome(state);
  console.info(
    "[Shell] updater state →",
    state.status,
    "| newVersion:",
    state.newVersion,
    "| startupCheckPending:",
    _startupCheckPending
  );

  if (state.status === "downloading") {
    bgTasks.registerTask("app-update", "shell.background_tasks.app_update", () => {
      Platform.updater?.cancel();
    });
    bgTasks.updateTask("app-update", { progress: state.progress ?? 0 });
  } else if (state.status === "downloaded") {
    bgTasks.completeTask("app-update");
  } else if (state.status === "error") {
    bgTasks.updateTask("app-update", { status: "error", error: state.error ?? undefined });
  }

  if (state.status === "available") {
    $appdata.set(KEYS.SHELL.APP_UPDATE_AVAILABLE, true);
    $appdata.set(KEYS.SHELL.APP_UPDATE_VERSION, state.newVersion || "");
    const action = startupActionForAvailableUpdate({
      startupCheckPending: _startupCheckPending,
      autoDownload: _autoDownloadUpdates(),
      newVersion: state.newVersion,
      skippedVersion: $userdata.get<string>(KEYS.OPTIONS.SKIP_UPDATE_NOTIFICATION_VERSION, ""),
    });
    if (action !== "ignore") _startupCheckPending = false;
    if (action === "prompt") {
      _openUpdatePrompt(
        state.newVersion || "",
        "available",
        state.installRequiresElevation === true
      );
    } else if (action === "suppressed") {
      // Versão dispensada → seguir para release notes / startup
      Telemetry.track("app_update_prompt_suppressed", { version: state.newVersion || "" });
      void _continueBootAfterUpdate();
    } else if (action === "continue") {
      // Download automático: o main já baixa em segundo plano (com a barra nas
      // tarefas) e instala ao fechar. A abertura segue agora — esperar o
      // download prendia as novidades e a verificação inicial atrás de um
      // download que, numa rede de igreja, pode levar minutos, e que não
      // terminava nunca se fosse cancelado.
      void _continueBootAfterUpdate();
    }
  } else if (state.status === "downloaded") {
    $appdata.set(KEYS.SHELL.APP_UPDATE_AVAILABLE, true);
    $appdata.set(KEYS.SHELL.APP_UPDATE_VERSION, state.newVersion || "");
    // Uma cópia antiga em Program Files não pode instalar em silêncio ao
    // fechar o app. Mostre o diálogo mesmo quando o download aconteceu em
    // background, para que o operador veja a permissão UAC necessária.
    if (state.installRequiresElevation && state.newVersion && !updateDialogOpen.value) {
      _openUpdatePrompt(state.newVersion, "downloaded", true);
      _startupCheckPending = false;
    }
    // Download manual via dialog → o dialog já mostra o estado "instalar";
    // não reabrir as notas por cima. Segue para release notes / startup.
    // Mesma guarda do ramo acima: baixar pelas Opções não é boot.
    if (_startupCheckPending && !updateDialogOpen.value) {
      void _continueBootAfterUpdate();
    }
  } else if (state.status === "not-available" || state.status === "error") {
    $appdata.set(KEYS.SHELL.APP_UPDATE_AVAILABLE, false);
    // Só encadeia o boot quando este estado veio da verificação de abertura.
    // O botão "Verificar" das Opções emite exatamente o mesmo estado, e sem a
    // guarda ele reabria a Verificação Inicial por cima da tela de Opções.
    if (_startupCheckPending) {
      _startupCheckPending = false;
      // Sem update → seguir para a verificação inicial
      void _continueBootAfterUpdate();
    }
  }
}

async function _runStartupUpdateCheck() {
  if (!Platform.isDesktop || !Platform.updater) {
    void _continueBootAfterUpdate();
    return;
  }
  const checkOnStart = $userdata.get<boolean>(KEYS.OPTIONS.CHECK_UPDATES_ON_START, true) === true;
  const autoDownload = _autoDownloadUpdates();
  console.info(
    "[Shell] startup update check → checkOnStart:",
    checkOnStart,
    "| autoDownload:",
    autoDownload
  );
  if (!checkOnStart) {
    // Preferência desligada: não checa, mas segue o fluxo normal de boot
    Telemetry.track("app_update_check_skipped", { trigger: "startup", reason: "disabled" });
    void _continueBootAfterUpdate();
    return;
  }
  _startupCheckPending = true;
  const startedAt = Date.now();
  Telemetry.track("app_update_check_started", { trigger: "startup", auto_download: autoDownload });

  // Fallback por timeout: se o check não concluir (rede lenta / IPC travado),
  // libera o fluxo de boot para não ficar preso esperando.
  _startupCheckTimeout = setTimeout(() => {
    if (_startupCheckPending) {
      console.warn("[Shell] startup update check demorou demais — seguindo para startup check");
      Telemetry.track("app_update_check_timeout", { trigger: "startup" });
      _startupCheckPending = false;
      void _continueBootAfterUpdate();
    }
  }, 15000);

  try {
    const res = await Platform.updater.check();
    console.info("[Shell] startup update check → resultado:", res);
    if (res && res.ok) {
      $userdata.set(KEYS.OPTIONS.LAST_APP_CHECK, new Date().toISOString());
      const checked = (res as { state?: { status?: string } }).state;
      Telemetry.track("app_update_check_completed", {
        trigger: "startup",
        available: checked?.status === "available",
        duration_ms: Date.now() - startedAt,
      });
    } else if (res && !res.ok) {
      Telemetry.track("app_update_check_failed", {
        trigger: "startup",
        duration_ms: Date.now() - startedAt,
      });
      // Check falhou sem emitir estado (ex: erro no main). Segue o fluxo
      // de boot para não depender do updater.
      console.warn("[Shell] startup update check retornou erro:", res?.error);
      if (_startupCheckPending) {
        void _continueBootAfterUpdate();
      }
    }
  } catch (e) {
    console.warn("[Shell] startup update check falhou:", e);
    Telemetry.track("app_update_check_failed", {
      trigger: "startup",
      duration_ms: Date.now() - startedAt,
    });
    if (_startupCheckPending) {
      void _continueBootAfterUpdate();
    }
  } finally {
    if (_startupCheckTimeout) {
      clearTimeout(_startupCheckTimeout);
      _startupCheckTimeout = null;
    }
  }
}

// Métodos expostos via shell._ref para outros componentes
function openCommandPalette() {
  cmdPaletteOpen.value = true;
}
function openHotkeysCheatsheet() {
  hotkeysOpen.value = true;
}
function openMusicSearch() {
  musicSearchOpen.value = true;
}
function openBibleSearch() {
  bibleSearchOpen.value = true;
}

defineExpose({ openCommandPalette, openHotkeysCheatsheet, openMusicSearch, openBibleSearch });

// Ao fechar o modal de novidades: persiste a dispensa (se marcado).
function onReleaseNotesClose() {
  // Marcar aqui, e não num checkbox: quem fechava pelo botão ou pelo ESC não
  // gravava nada, e as mesmas notas voltavam em todo boot, para sempre.
  $userdata.set(KEYS.OPTIONS.SKIP_RELEASE_NOTES_VERSION, packageJson.version);
  if (_bootPhase === "release-notes") {
    void _showPendingStartupCheck();
  }
}

// Handler: iniciar download da atualização a partir do dialog
function onUpdateDialogDownload() {
  if (!_updatePromptAnswered) {
    _updatePromptAnswered = true;
    Telemetry.track("app_update_prompt_answered", {
      version: updateDialogVersion.value,
      action: "update",
      dont_show_again: false,
    });
  }
  if (Platform.updater) {
    // O download segue em segundo plano e o estado fica visível nas tarefas e
    // em Opções → Atualizações. Não deixe o diálogo de boot cobrindo a Shell.
    updateDialogOpen.value = false;
    _continueBootIfWaitingOnPrompt();
    void Platform.updater.download().catch((error: unknown) => {
      console.error("[Shell] download da atualização falhou:", error);
      Telemetry.captureException(error, { source: "app_update_download" });
    });
  }
}

// Handler: dialog de update fechado (sem download) → seguir para release notes/startup
function onUpdateDialogClose() {
  if (!_updatePromptAnswered) {
    _updatePromptAnswered = true;
    const version = updateDialogVersion.value;
    Telemetry.track("app_update_prompt_answered", {
      version,
      action: "later",
      dont_show_again:
        !!version &&
        $userdata.get<string>(KEYS.OPTIONS.SKIP_UPDATE_NOTIFICATION_VERSION, "") === version,
    });
  }
  _continueBootIfWaitingOnPrompt();
}

// Com o download automático ligado, o aviso de "precisa de administrador" pode
// abrir depois que a abertura já seguiu (novidades, verificação inicial). Fechar
// esse aviso não pode reiniciar a abertura por cima da verificação em curso.
function _continueBootIfWaitingOnPrompt() {
  if (_bootPhase === "idle") void _continueBootAfterUpdate();
}

// Registra ações do shell no composable (substitui `$appdata.set("shell._ref")`)
registerShell({ openCommandPalette, openHotkeysCheatsheet, openMusicSearch, openBibleSearch });

onMounted(() => {
  // Download ou verificação inicial cortados pelo fechamento do app na sessão
  // anterior: relata agora, antes que uma rodada nova sobrescreva o registro.
  reportUnfinishedRuns();

  // Re-registra no mount (importante após HMR)
  registerShell({ openCommandPalette, openHotkeysCheatsheet, openMusicSearch, openBibleSearch });

  window.addEventListener("louvorja:open-command-palette", onOpenCommandPalette);
  window.addEventListener("louvorja:open-hotkeys", onOpenHotkeys);
  window.addEventListener("louvorja:open-music-search", onOpenMusicSearch);
  window.addEventListener("louvorja:open-bible-search", onOpenBibleSearch);
  window.addEventListener("louvorja:open-startup-check", onOpenStartupCheck);
  window.addEventListener("louvorja:toggle-chat", toggleChat);

  // Reseta estado da projeção background — garante que restarts
  // (normais ou por crash) não deixam a chave "presada" como true
  $userdata.set(KEYS.MODULES.BACKGROUND_PROJECTION.IS_PLAYING, false);

  applyStoredTheme();

  catalogAutoInstallTimer = setTimeout(() => {
    catalogAutoInstallTimer = null;
    catalogAutoInstallArmed = true;
    autoInstallCatalog();
  }, CATALOG_AUTO_INSTALL_DELAY_MS);

  // Idioma
  const lang = $userdata.get<string>(KEYS.OPTIONS.LANGUAGE);
  if (lang && lang !== "") {
    locale.value = lang;
  } else {
    $userdata.set(KEYS.OPTIONS.LANGUAGE, locale.value);
  }

  // Plataforma
  const isDev = import.meta.env.VITE_APP_MODE === "development";
  $appdata.set(KEYS.SHELL.IS_DEV, isDev);

  // No web/PWA, beforeunload com preventDefault mostra prompt "Tem certeza
  // que quer sair?". No Electron, esse mesmo preventDefault CANCELA o close
  // da janela silenciosamente — usuário clica no X e nada acontece.
  // Portanto só registra fora do Electron.
  const isElectron = !!window.louvorjaApi;
  if (!isDev && !isElectron) {
    beforeUnloadHandler = (e) => {
      if (!_hasWorkInProgress()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnloadHandler);
  }

  // pagehide: flush de itens agendados antes do unload (web + Electron).
  window.addEventListener("pagehide", onPageHide);

  $appdata.set(KEYS.SHELL.IS_MOBILE, platform.android || platform.ios);
  if (platform.electron) {
    $appdata.set(KEYS.SHELL.IS_DESKTOP, true);
  } else {
    $appdata.set(KEYS.SHELL.IS_DESKTOP, false);
  }

  // Startup check — só no desktop. O diálogo acompanha a instalação automática
  // do catálogo; a varredura detalhada e os downloads de mídia ficam por escolha.
  // O fluxo dos diálogos é: update check → release notes → startup check.
  if (platform.electron) {
    // As notas pertencem a uma atualização, não a uma versão. Sem registrar a
    // versão da execução anterior, uma instalação nova (chave vazia) contava
    // como "mudou" e mostrava changelog para quem nunca atualizou nada.
    const previousVersion = $userdata.get<string | null>(KEYS.OPTIONS.LAST_RUN_VERSION, null);
    _pendingReleaseNotes = shouldShowReleaseNotes({
      previousVersion,
      seenVersion: $userdata.get<string | null>(KEYS.OPTIONS.SKIP_RELEASE_NOTES_VERSION, null),
      currentVersion: packageJson.version,
    });
    // A verificação inicial é apresentação para instalação nova. Quem já rodava
    // o app antes desta versão não deve ganhar um diálogo que nunca viu.
    if (previousVersion && !$userdata.get<boolean>(KEYS.OPTIONS.STARTUP_CHECK_DONE, false)) {
      $userdata.set(KEYS.OPTIONS.STARTUP_CHECK_DONE, true);
    }
    $userdata.set(KEYS.OPTIONS.LAST_RUN_VERSION, packageJson.version);
    if (_pendingReleaseNotes && Platform.updater) {
      _releaseNotesPromise = Platform.updater.getReleaseNotes().catch(() => null);
    }
  }

  // Auto-update: assina mudanças de estado do updater para acender o badge
  // da ShellTools e mostrar o dialog quando o check ao iniciar encontra
  // versão nova.
  console.info(
    "[Shell] boot updater → isDesktop:",
    Platform.isDesktop,
    "| updater:",
    !!Platform.updater,
    "| api:",
    !!Platform.api
  );
  if (Platform.isDesktop && Platform.displays?.onChanged) {
    try {
      _displaysUnsub = Platform.displays.onChanged(_handleDisplaysChanged);
    } catch (e) {
      console.warn("[Shell] displays.onChanged falhou:", e);
    }
  }

  if (Platform.isDesktop && Platform.updater) {
    try {
      _updaterUnsub = Platform.updater.onStateChange(_handleUpdaterState);
    } catch (e) {
      console.warn("[Shell] updater.onStateChange falhou:", e);
    }
    // Reaplica o estado atual caso o update já tenha sido encontrado antes do mount
    Platform.updater
      .status()
      .then((s: { status: string; newVersion?: string | null } | null) => {
        console.info("[Shell] status replay:", s);
        _handleUpdaterState(s);
      })
      .catch((e: unknown) => console.warn("[Shell] status replay falhou:", e));
  } else {
    // Sem updater (web/PWA): segue direto para release notes/startup.
  }

  if (Platform.isDesktop) {
    void ensureStorageSetup().then(() => _runStartupUpdateCheck());
  } else {
    void _continueBootAfterUpdate();
  }

  openClockProjectionOnBoot();

  // Bridge popup → main (replica popup ↔ shell)
  messageHandler = (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data === "mounted") {
      const popup = $appdata.get<Window | null>(KEYS.SHELL.POPUP, null);
      if (popup) {
        const data = $appdata.getFlatten();
        Object.keys(data).forEach((key) => {
          try {
            popup.postMessage({ param: key, value: data[key] }, window.location.origin);
          } catch {
            /* ignore */
          }
        });
      }
    } else if (event.data === "closed") {
      $popup.close();
    }
  };
  window.addEventListener("message", messageHandler);

  // Fade-in 256ms (replica AlphaBlend Delphi)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ready.value = true;
    });
  });
});

onBeforeUnmount(() => {
  if (catalogAutoInstallTimer) clearTimeout(catalogAutoInstallTimer);
  catalogAutoInstallArmed = false;
  if (clockBootTimer) {
    clearTimeout(clockBootTimer);
    clockBootTimer = null;
  }
  if (beforeUnloadHandler) window.removeEventListener("beforeunload", beforeUnloadHandler);
  window.removeEventListener("pagehide", onPageHide);
  if (messageHandler) window.removeEventListener("message", messageHandler);

  if (_updaterUnsub) {
    try {
      _updaterUnsub();
    } catch (_) {
      /* ignore */
    }
  }

  if (_displaysUnsub) {
    try {
      _displaysUnsub();
    } catch (_) {
      /* ignore */
    }
  }

  window.removeEventListener("louvorja:open-command-palette", onOpenCommandPalette);
  window.removeEventListener("louvorja:open-hotkeys", onOpenHotkeys);
  window.removeEventListener("louvorja:open-music-search", onOpenMusicSearch);
  window.removeEventListener("louvorja:open-bible-search", onOpenBibleSearch);
  window.removeEventListener("louvorja:open-startup-check", onOpenStartupCheck);
  window.removeEventListener("louvorja:toggle-chat", toggleChat);
});
</script>

<style scoped>
/* Raiz da shell — coluna que ocupa a janela inteira, dentro do
   `#app-container` de App.vue, que já dá a altura de janela e a superfície. */
.shell-root {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  max-width: 100%;
  height: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  backface-visibility: hidden;
  transition: opacity var(--lj-transition-fast);
}

/* Fade-in rápido (antes 256ms herdado do AlphaBlend Delphi) */
.shell-root.shell-fading-in {
  opacity: 0;
}

/* `1 1 auto` + `min-height: 0`: o miolo recebe a altura que sobra entre a
   ribbon e o player, e nunca a altura do que está dentro dele. Com `1 0 auto`
   ele não encolhia, adotava o tamanho do conteúdo e transbordava a janela —
   nenhum módulo revelava isso porque todos se posicionam em `absolute`, mas o
   painel de liturgia cresce com a lista: numa liturgia de vinte itens o fim
   ficava cortado no rodapé, e a rolagem interna nunca chegava a existir. */
.shell-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  max-width: 100%;
  overflow: hidden;
  padding-bottom: var(--lj-dock-offset, 0px);
  /* Mesmo token do `transform` do rodapé (Footer.vue): os dois andam juntos. */
  transition: padding-bottom var(--lj-reflow-enter);
}
.shell-grid {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.shell-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  margin-left: 0;
  /* Mesmo token do chat pinado (ChatDrawer.vue): os dois andam juntos. */
  transition: margin-left var(--lj-reflow-enter);
}
.shell-center--drawer-pinned {
  margin-left: 300px;
}
.shell-content {
  flex: 1;
  overflow: auto;
  position: relative;
  /* O fundo inicial acompanha a luminosidade real da superfície do tema. */
  background: var(--lj-home-bg);
  color: var(--lj-home-text);
}
/* Mesma superfície de .module-embedded (ModuleContainer.vue).
   O atraso é o tempo de entrada do primeiro módulo (PAGE_LEAVE_MS em
   useModuleSwap.ts): vindo da tela inicial, o fundo continua na cor do tema
   até o módulo terminar de cobri-lo, e a página dissolve sobre a tela inicial
   em vez de sobre um quadro branco. Na volta a classe sai sem atraso — o
   módulo esmaece direto sobre a cor do tema. */
.shell-content--has-module {
  background: var(--lj-surface-bg);
  transition: background-color 0s linear 0.3s;
  /* O módulo ocupa a área inteira e rola por conta própria. Sem isto, a página
     que entra deslizando pela direita aumenta a área de rolagem daqui por um
     instante, e a barra de rolagem pisca a cada troca de aba. `clip` nem
     chega a criar área de rolagem; `hidden` é a reserva. */
  overflow: hidden;
  overflow: clip;
}

.shell-sidebar {
  flex-shrink: 0;
}

/* Em telas baixas o aviso de atualização não pode reduzir a lista a zero.
   Mantém o aviso visível e permite alcançar o conteúdo rolando a janela. */
@media (max-height: 650px) {
  .shell-root--web:has(> .pwa-update-notice) {
    overflow-y: auto;
  }

  .shell-root--web:has(> .pwa-update-notice) .shell-main {
    flex-shrink: 0;
    min-height: max(320px, 100dvh);
  }

  .shell-root--web:has(> .pwa-update-notice) :deep(.footer) {
    position: fixed;
  }
}

@media (max-width: 700px) {
  .shell-root {
    --lj-sidebar-collapsed: 44px;
    min-height: 0;
  }

  .shell-grid--with-sidebar .shell-center {
    margin-right: var(--lj-sidebar-collapsed);
  }
}

@media (min-width: 701px) and (max-width: 1000px) and (pointer: coarse) {
  .shell-root--web {
    --lj-sidebar-collapsed: 45px;
  }

  .shell-root--web .shell-grid--with-sidebar .shell-center {
    margin-right: var(--lj-sidebar-collapsed);
  }
}
</style>
