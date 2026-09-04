<template>
  <div class="opt">
    <section v-if="isDesktop" class="opt-section">
      <h3 class="opt-section-title">{{ $t("options.updates.app") }}</h3>

      <div class="opt-row opt-row--col">
        <label class="opt-label">v{{ appVersion }}</label>
        <div class="opt-folder-path">{{ appUpdateStatusText }}</div>
        <div v-if="lastAppCheck" class="opt-row opt-row--spread">
          <label class="opt-label">{{ $t("options.updates.last_check") }}</label>
          <span>{{ formatLastCheck(lastAppCheck) }}</span>
        </div>
        <div v-if="appUpdate.status === 'downloading'" class="w-100">
          <v-progress
            color="primary"
            :label="$t('options.updates.app_downloading')"
            :model-value="appUpdate.progress"
          ></v-progress>
        </div>
        <div class="opt-folder-actions">
          <button
            v-if="['idle', 'not-available', 'error'].includes(appUpdate.status)"
            type="button"
            class="opt-btn"
            :disabled="appUpdate.status === 'checking'"
            @click="checkAppUpdate"
          >
            <v-icon icon="mdi-refresh" size="14" class="mr-1" />
            {{ $t("options.updates.check") }}
          </button>
          <button
            v-if="appUpdate.status === 'available'"
            type="button"
            class="opt-btn opt-btn--primary"
            @click="startDownload"
          >
            <v-icon icon="mdi-download" size="14" class="mr-1" />
            {{ $t("options.updates.app_update_button", { version: appUpdate.newVersion }) }}
          </button>
          <button
            v-if="appUpdate.status === 'downloaded'"
            type="button"
            class="opt-btn opt-btn--primary"
            @click="installUpdate"
          >
            <v-icon icon="mdi-restart" size="14" class="mr-1" />
            {{ $t("options.updates.install") }}
          </button>
          <button
            v-if="appUpdate.status === 'downloaded' && isDebRpm"
            type="button"
            class="opt-btn"
            @click="openPackageFile"
          >
            <v-icon icon="mdi-folder-open" size="14" class="mr-1" />
            {{ $t("options.updates.open_package") }}
          </button>
        </div>
      </div>

      <!-- Opções de atualização -->
      <div class="opt-row">
        <label class="opt-checkbox">
          <input type="checkbox" :checked="useBeta" @change="onUseBetaChange($c($event))" />
          <span>{{ $t("options.updates.use_beta_updates") }}</span>
        </label>
      </div>
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="checkOnStart"
            @change="onCheckOnStartChange($c($event))"
          />
          <span>{{ $t("options.updates.check_updates_on_start") }}</span>
        </label>
      </div>
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="autoDownload"
            @change="onAutoDownloadChange($c($event))"
          />
          <span>{{ $t("options.updates.auto_download_updates") }}</span>
        </label>
      </div>
    </section>

    <section class="opt-section">
      <h3 class="opt-section-title">{{ $t("options.updates.database") }}</h3>

      <div class="opt-row opt-row--spread">
        <label class="opt-label">{{ $t("options.updates.current_version") }}</label>
        <strong v-if="dbCurrentConfig">
          v{{ dbCurrentConfig.version_number }} - {{ dbCurrentConfig.version }}
        </strong>
        <strong v-else>—</strong>
      </div>
      <div class="opt-row opt-row--spread">
        <label class="opt-label">{{ $t("options.updates.db_date") }}</label>
        <span>
          {{ dbCurrentConfig?.datetime ? formatLastCheck(dbCurrentConfig.datetime) : "—" }}
        </span>
      </div>
      <div v-if="lastDbCheck" class="opt-row opt-row--spread">
        <label class="opt-label">{{ $t("options.updates.last_check") }}</label>
        <span>{{ formatLastCheck(lastDbCheck) }}</span>
      </div>

      <div class="opt-row opt-row--col">
        <div class="opt-folder-path">{{ dbUpdateStatusText }}</div>
        <div class="opt-folder-actions">
          <button type="button" class="opt-btn" :disabled="dbChecking" @click="checkDbUpdate">
            <v-icon icon="mdi-refresh" size="14" class="mr-1" />
            {{ $t("options.updates.check") }}
          </button>
          <button
            v-if="dbHasUpdate"
            type="button"
            class="opt-btn opt-btn--primary"
            @click="applyDbUpdate"
          >
            <v-icon icon="mdi-cloud-download" size="14" class="mr-1" />
            {{ $t("options.updates.apply") }}
          </button>
          <button type="button" class="opt-btn" @click="clearDbCache">
            <v-icon icon="mdi-broom" size="14" class="mr-1" />
            {{ $t("options.updates.clear_cache") }}
          </button>
          <button type="button" class="opt-btn" @click="clearCollectionsCache">
            <v-icon icon="mdi-broom" size="14" class="mr-1" />
            {{ $t("options.storage.clear_cache_collections") }}
          </button>
          <template v-if="isDesktop">
            <button type="button" class="opt-btn" :disabled="dbBackupBusy" @click="exportDatabase">
              <v-icon icon="mdi-download" size="14" class="mr-1" />
              {{ $t("options.updates.export_db") }}
            </button>
            <button
              type="button"
              class="opt-btn"
              :disabled="dbBackupBusy"
              @click="pickImportDatabase"
            >
              <v-icon icon="mdi-upload" size="14" class="mr-1" />
              {{ $t("options.updates.import_db") }}
            </button>
            <button
              type="button"
              class="opt-btn"
              :disabled="dbBackupBusy"
              @click="reinstallDatabase"
            >
              <v-icon icon="mdi-database-refresh" size="14" class="mr-1" />
              {{ $t("options.updates.reinstall_db") }}
            </button>
          </template>
        </div>
        <input
          ref="importFileInput"
          type="file"
          accept=".zip,application/zip"
          style="display: none"
          @change="onImportFileChange"
        />
      </div>
      <div v-if="dbBackupState !== 'idle'" class="opt-folder-path mt-2">
        {{
          dbBackupState === "exporting"
            ? $t("options.updates.exporting_db")
            : $t("options.updates.importing_db")
        }}
      </div>
      <div v-if="dbBackupState !== 'idle'" class="opt-backup-progress mt-2">
        <v-progress
          :model-value="dbBackupProgressPercent"
          :label="dbBackupProgressLabel"
          color="primary"
          rounded
        />
        <div v-if="dbBackupProgressDetail" class="opt-folder-path mt-1">
          {{ dbBackupProgressDetail }}
        </div>
      </div>
      <div v-if="dbBundleDisplayActive" class="opt-row opt-row--col mt-2">
        <div class="d-flex align-center ga-3 w-100">
          <v-progress
            class="flex-grow-1"
            :model-value="dbBundleProgressPercent"
            :label="$t('shell.background_tasks.db_bundle')"
            :indeterminate="dbBundleProgressPercent === 0"
            color="primary"
            rounded
          />
          <button type="button" class="opt-btn opt-btn--danger" @click="sync.cancelBundle()">
            <v-icon icon="mdi-close-circle" size="14" class="mr-1" />
            {{ $t("options.collections_download.cancel") }}
          </button>
        </div>
        <div v-if="dbBundleDetail" class="opt-folder-path mt-1">
          {{ dbBundleDetail }}
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import Platform from "@/helpers/Platform";
import $alert from "@/helpers/Alert";
import $database from "@/helpers/Database";
import $userdata from "@/helpers/UserData";
import DatabaseBackup, { type BackupProgress } from "@/helpers/DatabaseBackup";
import {
  formatBackgroundTaskDetail,
  formatBibleDownloadDetail,
} from "@/helpers/BackgroundTaskDetail";
import { KEYS } from "@/constants/UserDataKeys";
import { useSyncManager } from "@/composables/useSyncManager";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import type { DbConfig } from "@/types/Database";
import Alert from "@/helpers/Alert";
import Snackbar from "@helpers/Snackbar";

interface AppUpdateState {
  status: string;
  version: string | null;
  progress: number;
  newVersion: string | null;
  error: string | null;
  packagePath?: string | null;
}

type UpdateStatus = "idle" | "checking" | "ok" | "available" | "error";

const isDesktop = computed(() => Platform.isDesktop);
const { t, locale } = useI18n();

const appUpdate = ref<AppUpdateState>({
  status: "idle",
  version: "?",
  progress: 0,
  newVersion: null,
  error: null,
});
let _appUpdateUnsub: (() => void) | null = null;
let _pkgProgressUnsub: (() => void) | null = null;

const dbChecking = ref<boolean>(false);
const dbStatus = ref<UpdateStatus>("idle");
const dbCurrentConfig = ref<DbConfig | null>(null);
const dbLatestConfig = ref<DbConfig | null>(null);
const dbCacheCleared = ref<boolean>(false);
const lastDbCheck = ref<string | null>(null);
const lastAppCheck = ref<string | null>(null);

// Instalação Linux (deb/rpm) — download manual via GitHub API
const isDebRpm = ref(false);
const installType = ref<string>("");

// Opções da tela
const useBeta = ref(false);
const checkOnStart = ref(false);
const autoDownload = ref(false);

// Sync manager (bundle download)
const sync = useSyncManager();
const bgTasks = useBackgroundTasks();
const reinstallingDb = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
const dbBackupState = ref<"idle" | "exporting" | "importing">("idle");
const dbBackupProgress = ref<BackupProgress | null>(null);

const dbBundleTask = computed(() => bgTasks.tasks.value.find((t) => t.id === "db-bundle") ?? null);
const dbBundleRunning = computed(() => dbBundleTask.value?.status === "running");
const dbBundleDisplayActive = computed<boolean>(
  () => reinstallingDb.value || sync.bundleInstalling.value || dbBundleRunning.value
);
const dbBundleProgressPercent = computed<number>(() => {
  const progress = sync.bundleProgress.value;
  if (progress.phase === "download") {
    const received = progress.bytesReceived ?? progress.current;
    const total = progress.bytesTotal ?? 0;
    return total > 0 ? Math.round((received / total) * 100) : (dbBundleTask.value?.progress ?? 0);
  }
  return dbBundleTask.value?.progress ?? 0;
});
const dbBundleDetail = computed<string>(() => {
  const progress = sync.bundleProgress.value;
  if (progress.phase === "download") {
    const received = progress.bytesReceived ?? progress.current ?? 0;
    const rate = progress.bytesPerSecond ?? 0;
    const total = progress.bytesTotal ?? 0;
    if (received > 0) {
      if (total > 0) {
        return `${sync.humanSize(received)} / ${sync.humanSize(total)} · ${sync.humanSize(rate)}/s`;
      }
      return `${sync.humanSize(received)} baixados · ${sync.humanSize(rate)}/s`;
    }
  }

  const detail = dbBundleTask.value?.detail || progress.detail || "";
  if (!detail) return "";
  return formatBibleDownloadDetail(detail, t) || formatBackgroundTaskDetail(detail, t);
});

const dbBackupBusy = computed<boolean>(
  () =>
    dbBackupState.value !== "idle" ||
    reinstallingDb.value ||
    sync.bundleInstalling.value ||
    dbBundleRunning.value
);

const dbBackupProgressPercent = computed<number>(() => {
  const progress = dbBackupProgress.value;
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.current / progress.total) * 100)));
});

const dbBackupProgressLabel = computed<string>(() => {
  return dbBackupState.value === "exporting"
    ? t("options.updates.exporting_db")
    : t("options.updates.importing_db");
});

const dbBackupProgressDetail = computed<string>(() => {
  const progress = dbBackupProgress.value;
  if (!progress?.detail) return "";
  return formatBackupDetail(progress.detail);
});

const dbHasUpdate = computed<boolean>(
  () =>
    !!dbLatestConfig.value &&
    !!dbCurrentConfig.value &&
    dbLatestConfig.value.version_number !== dbCurrentConfig.value.version_number
);

const appVersion = computed<string>(() => appUpdate.value.version || Platform.api?.version || "?");

const appUpdateStatusText = computed<string>(() => {
  switch (appUpdate.value.status) {
    case "checking":
      return t("options.updates.app_checking");
    case "available":
      return t("options.updates.app_available", { version: appUpdate.value.newVersion });
    case "not-available":
      return t("options.updates.app_up_to_date");
    case "downloading":
      return t("options.updates.app_downloading");
    case "downloaded":
      return t("options.updates.app_downloaded");
    case "error":
      return appUpdate.value.error || t("options.updates.app_error");
    default:
      return t("options.updates.app_idle");
  }
});

const dbUpdateStatusText = computed<string>(() => {
  if (dbCacheCleared.value) return t("options.updates.cache_cleared");
  if (dbChecking.value) return t("options.updates.db_checking");
  if (dbStatus.value === "ok") return t("options.updates.db_up_to_date");
  if (dbStatus.value === "available")
    return t("options.updates.db_available", {
      version: `v${dbLatestConfig.value?.version_number} - ${dbLatestConfig.value?.version}`,
    });
  if (dbStatus.value === "error") return t("options.updates.db_error");
  return t("options.updates.db_idle");
});

/* ---- Helpers de evento (TypeScript strict) ---- */
function $c(e: Event): boolean {
  return (e.target as HTMLInputElement).checked;
}

/* ---- Opções ---- */
function pushOptions(): void {
  if (!Platform.updater) return;
  Platform.updater.setOptions({
    useBeta: useBeta.value,
    autoCheck: checkOnStart.value,
    autoDownload: autoDownload.value,
  });
}

function onUseBetaChange(v: boolean): void {
  useBeta.value = v;
  $userdata.set(KEYS.OPTIONS.USE_BETA_UPDATES, v);
  pushOptions();
}

function onCheckOnStartChange(v: boolean): void {
  checkOnStart.value = v;
  $userdata.set(KEYS.OPTIONS.CHECK_UPDATES_ON_START, v);
  pushOptions();
}

function onAutoDownloadChange(v: boolean): void {
  autoDownload.value = v;
  $userdata.set(KEYS.OPTIONS.AUTO_DOWNLOAD_UPDATES, v);
  pushOptions();
}

/* ---- App update ---- */
async function checkAppUpdate(): Promise<void> {
  if (!Platform.updater) return;
  try {
    const res = await Platform.updater.check();
    // Só registra a última verificação quando o check concluiu com sucesso.
    if (res && res.ok) {
      const ts = new Date().toISOString();
      lastAppCheck.value = ts;
      $userdata.set(KEYS.OPTIONS.LAST_APP_CHECK, ts);
    }
  } catch (e) {
    console.error("[Atualizações] checkApp:", e);
  }
}

async function startDownload(): Promise<void> {
  if (!Platform.updater) return;
  if (isDebRpm.value) {
    try {
      const res = await Platform.updater.downloadPackage();
      if (res && res.ok) {
        $alert.yesno(
          {
            title: t("options.updates.app_install_title"),
            text: t("options.updates.app_downloaded_to", { path: res.path || "" }),
            translate: false,
          },
          (btn?: string) => {
            if (btn === "yes") openPackageFile();
          }
        );
      } else if (res && !res.ok && res.error) {
        $alert.yesno(
          {
            title: t("options.updates.app_install_title"),
            text: t("options.updates.app_asset_missing"),
            translate: false,
          },
          (btn?: string) => {
            if (btn === "yes") Platform.updater?.openReleasePage();
          }
        );
      }
    } catch (e) {
      console.error("[Atualizações] downloadPackage:", e);
      const msg = String(e && (e as Error).message ? (e as Error).message : e);
      $alert.yesno(
        {
          title: t("options.updates.app_install_title"),
          text: `${t("options.updates.app_asset_missing")}\n\n${msg}`,
          translate: false,
        },
        (btn?: string) => {
          if (btn === "yes") Platform.updater?.openReleasePage();
        }
      );
    }
    return;
  }

  // Win/mac/AppImage/deb — electron-updater baixa em background
  try {
    await Platform.updater.download();
  } catch (e) {
    console.error("[Atualizações] download:", e);
  }
}

async function installUpdate(): Promise<void> {
  // deb/rpm: abre o pacote no gerenciador de pacotes
  if (isDebRpm.value) {
    await openPackageFile();
    return;
  }
  await Platform.updater?.install();
}

async function openPackageFile(): Promise<void> {
  if (!Platform.updater) return;
  try {
    const res = await Platform.updater.openPackage();
    if (res && !res.ok) {
      $alert.error({ text: res.error || t("options.updates.app_error") });
    }
  } catch (e) {
    console.error("[Atualizações] openPackage:", e);
  }
}

async function checkDbUpdate(): Promise<void> {
  dbChecking.value = true;
  dbStatus.value = "idle";
  try {
    const res = await fetch(`${import.meta.env.VITE_URL_DATABASE}/config`, {
      headers: { "Api-Token": import.meta.env.VITE_API_TOKEN },
    });
    if (!res.ok) {
      throw new Error();
    }
    const data: DbConfig = await res.json();
    dbLatestConfig.value = data ?? null;
    dbStatus.value = dbHasUpdate.value ? "available" : "ok";
    lastDbCheck.value = new Date().toISOString();
    $userdata.set(KEYS.OPTIONS.LAST_DB_CHECK, lastDbCheck.value);
  } catch {
    dbStatus.value = "error";
  } finally {
    dbChecking.value = false;
  }
}

async function applyDbUpdate(): Promise<void> {
  if (isDesktop.value) {
    const ok = await sync.downloadBundle();
    if (!ok) return;
    dbCacheCleared.value = true;
    dbCurrentConfig.value = dbLatestConfig.value;
    await new Promise<void>((r) => setTimeout(r, 1000));
    window.location.reload();
  } else {
    sessionStorage.clear();
    $database.invalidate("config");
    dbCacheCleared.value = true;
    dbStatus.value = "ok";
    dbCurrentConfig.value = dbLatestConfig.value;
    await new Promise<void>((r) => setTimeout(r, 2000));
    window.location.reload();
  }
}

function formatLastCheck(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

async function clearDbCache(): Promise<void> {
  sessionStorage.clear();
  $database.invalidate(); // memória + tabela db_cache inteira
  dbCacheCleared.value = true;
  setTimeout(() => {
    dbCacheCleared.value = false;
  }, 4000);
}

/** Limpa apenas os caches de música/coletâneas do locale atual. */
function clearCollectionsCache(): void {
  const files = ["musics", "hymnal", "hymnal_1996", "categories"];
  for (const f of files) $database.invalidate(`${locale.value}_${f}`);
  dbCacheCleared.value = true;
  setTimeout(() => {
    dbCacheCleared.value = false;
  }, 4000);
}

function formatBackupDetail(detail: string): string {
  const labels: Record<string, string> = {
    loading: t("options.updates.import_db_loading"),
    clearing: t("options.updates.import_db_clearing"),
    writing: t("options.updates.import_db_writing"),
    cache: t("options.updates.database"),
    musics: t("modules.musics.title"),
    hymnal: t("modules.collections_download.hymnal"),
    hymnal_1996: t("modules.collections_download.hymnal_1996"),
    albums: t("modules.albums.title"),
  };
  if (labels[detail]) return labels[detail];
  return detail.replace(/_/g, " ");
}

function setBackupProgress(progress: BackupProgress | null): void {
  dbBackupProgress.value = progress;
}

function pickImportDatabase(): void {
  if (dbBackupBusy.value) return;
  importFileInput.value?.click();
}

async function exportDatabase(): Promise<void> {
  if (dbBackupBusy.value) return;
  dbBackupState.value = "exporting";
  setBackupProgress({ phase: "export", current: 0, total: 1, detail: "loading" });
  try {
    const res = await DatabaseBackup.exportAll((progress) => setBackupProgress(progress));
    $alert.info({
      title: t("options.updates.export_db_title"),
      text: t("options.updates.export_db_done", {
        file: res.fileName,
        tables: res.tables,
        rows: res.rows,
      }),
      translate: false,
    });
  } catch (e) {
    console.error("[Atualizações] exportDatabase:", e);
    $alert.error({
      title: t("options.updates.export_db_title"),
      text: t("options.updates.export_db_error"),
      translate: false,
    });
  } finally {
    dbBackupState.value = "idle";
    setBackupProgress(null);
  }
}

async function onImportFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0] || null;
  input.value = "";
  if (!file || dbBackupBusy.value) return;

  $alert.yesno(
    {
      title: t("options.updates.import_db_title"),
      text: t("options.updates.import_db_confirm"),
      translate: false,
    },
    async (btn?: string) => {
      if (btn !== "yes") return;
      dbBackupState.value = "importing";
      setBackupProgress({ phase: "import", current: 0, total: 1, detail: "loading" });
      try {
        const res = await DatabaseBackup.importAll(file, (progress) => setBackupProgress(progress));
        $alert.info(
          {
            title: t("options.updates.import_db_title"),
            text: t("options.updates.import_db_done", { tables: res.tables, rows: res.rows }),
            translate: false,
          },
          () => window.location.reload()
        );
      } catch (err) {
        console.error("[Atualizações] importDatabase:", err);
        $alert.error({
          title: t("options.updates.import_db_title"),
          text: t("options.updates.import_db_error"),
          translate: false,
        });
      } finally {
        dbBackupState.value = "idle";
        setBackupProgress(null);
      }
    }
  );
}

async function reinstallDatabase(): Promise<void> {
  if (reinstallingDb.value || dbBundleRunning.value) return;
  $alert.yesno("options.updates.reinstall_db_confirm", async (btn?: string) => {
    if (btn !== "yes") return;
    if (dbBundleRunning.value) return;
    reinstallingDb.value = true;
    try {
      const ok = await sync.downloadBundle({ force: true });
      if (ok) {
        dbCacheCleared.value = true;
        await new Promise<void>((r) => setTimeout(r, 1000));
        window.location.reload();
      } else {
        Snackbar.warning(t("startup_check.bundle_cancel"));
      }
    } catch (e) {
      console.error("[Atualizações] reinstallDatabase:", e);
      Snackbar.error(t("startup_check.bundle_error"));
    } finally {
      reinstallingDb.value = false;
    }
  });
}

async function loadCurrentDbVersion(): Promise<void> {
  try {
    dbCurrentConfig.value = await $database.get<DbConfig>("config", { silent: true });
  } catch {
    dbCurrentConfig.value = null;
  }
}

onMounted(async () => {
  lastDbCheck.value = $userdata.get<string>(KEYS.OPTIONS.LAST_DB_CHECK, null);
  lastAppCheck.value = $userdata.get<string>(KEYS.OPTIONS.LAST_APP_CHECK, null);

  // Opções persistidas.
  // TODO: remover o default true do useBeta quando a versão estável for publicada.
  const savedBeta = $userdata.get<boolean | null>(KEYS.OPTIONS.USE_BETA_UPDATES, null);
  useBeta.value = savedBeta == null ? true : savedBeta;
  checkOnStart.value = $userdata.get<boolean>(KEYS.OPTIONS.CHECK_UPDATES_ON_START, true) === true;
  autoDownload.value = $userdata.get<boolean>(KEYS.OPTIONS.AUTO_DOWNLOAD_UPDATES, false) === true;

  if (Platform.isDesktop && Platform.updater) {
    try {
      // Tipo de instalação Linux (deb/rpm)
      installType.value = (await Platform.updater.getInstallType()) || "";
      isDebRpm.value = installType.value === "deb" || installType.value === "rpm";

      appUpdate.value = (await Platform.updater.status()) as AppUpdateState;
      let prevStatus = appUpdate.value.status;
      _appUpdateUnsub = Platform.updater.onStateChange((s: AppUpdateState) => {
        appUpdate.value = s;
        // Ao concluir o download do electron-updater, avisa para reiniciar.
        // Mostra apenas na TRANSIÇÃO para "downloaded" (senão ao abrir a tela
        // com download já concluído em background repetiria o prompt).
        if (s.status === "downloaded" && prevStatus !== "downloaded" && !isDebRpm.value) {
          $alert.yesno(
            {
              title: t("options.updates.app_install_title"),
              text: t("options.updates.app_restart_prompt", { version: s.newVersion }),
              translate: false,
            },
            (btn?: string) => {
              if (btn === "yes") installUpdate();
            }
          );
        }
        prevStatus = s.status;
      });
      _pkgProgressUnsub = Platform.updater.onPackageProgress((d: { percent: number }) => {
        if (d && typeof d.percent === "number") {
          appUpdate.value = { ...appUpdate.value, status: "downloading", progress: d.percent };
        }
      });
      pushOptions();
    } catch (e) {
      console.warn("[Atualizações] init:", e);
    }
  }
  await loadCurrentDbVersion();
  await checkDbUpdate();
});

onBeforeUnmount(() => {
  if (_appUpdateUnsub) _appUpdateUnsub();
  if (_pkgProgressUnsub) _pkgProgressUnsub();
});
</script>
