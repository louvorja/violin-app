<template>
  <div class="opt">
    <section v-if="!isDesktop" class="opt-section">
      <p class="opt-empty">{{ $t("options.transmission.desktop_only") }}</p>
    </section>

    <template v-else>
      <!-- Servidor: start/stop + token + port + external routes toggle -->
      <section class="opt-section">
        <h3 class="opt-section-title">
          <LjIcon :icon="ICONS.UI.SERVER" :size="18" />
          {{ $t("options.transmission.http_server") }}
          <span class="tx-title-hint">
            {{ $t("options.transmission.http_server_hint") }}
          </span>
        </h3>

        <div class="tx-status">
          <span class="tx-dot" :class="{ 'tx-dot--on': httpServer.running }" />
          <span v-if="httpServer.running" class="tx-status-url">
            {{ baseUrl }}
          </span>
          <span v-else class="tx-status-text">
            {{ $t("options.transmission.server_stopped") }}
          </span>
          <LjButton
            size="sm"
            :variant="httpServer.running ? 'danger' : 'primary'"
            :disabled="httpServerLoading"
            :icon="httpServer.running ? ICONS.ACTIONS.STOP : ICONS.ACTIONS.START"
            @click="toggleHttpServer"
          >
            {{
              httpServer.running
                ? $t("options.transmission.stop_server")
                : $t("options.transmission.start_server")
            }}
          </LjButton>
        </div>

        <div class="tx-token-row">
          <div>
            <label class="opt-label" for="tx-ip">
              {{ $t("options.transmission.select_ip") }}
            </label>
            <p class="opt-hint">{{ $t("options.transmission.select_ip_hint") }}</p>
            <LjSelect
              id="tx-ip"
              size="sm"
              style="width: 130px"
              :items="localIps.map((ip) => ({ value: ip, label: ip }))"
              :model-value="selectedIp"
              @update:model-value="selectedIp = String($event)"
            />
          </div>

          <div style="margin: 0 20px 0 20px">
            <label class="opt-label" for="tx-port">
              {{ $t("options.transmission.port") }}
            </label>
            <p class="opt-hint">{{ $t("options.transmission.port_hint") }}</p>
            <span class="tx-port">
              <LjInput
                id="tx-port"
                size="sm"
                type="number"
                placeholder="7070"
                :model-value="httpServerPort"
                min="1"
                max="65535"
                @change="setHttpServerPort(Number($event.target.value))"
              />
            </span>
          </div>
          <div>
            <span class="tx-token-label">{{ $t("options.transmission.token_label") }}</span>
            <p class="opt-hint">{{ $t("options.transmission.port_hint") }}</p>
            <div class="tx-token-row">
              <input
                v-model="tokenInput"
                class="tx-token-input"
                type="text"
                maxlength="20"
                spellcheck="false"
                autocomplete="off"
              />
              <LjButton
                size="sm"
                :icon="ICONS.ACTIONS.SAVE"
                :disabled="
                  !httpServer.running || tokenInput === httpServer.token || !tokenInput.trim()
                "
                @click="saveToken"
              >
                {{ $t("actions.save") }}
              </LjButton>
              <LjButton size="sm" :icon="ICONS.UI.COPY" @click="copyToken">
                {{ $t("actions.copy") }}
              </LjButton>
              <LjButton size="sm" :icon="ICONS.ACTIONS.RESTART" @click="resetToken">
                {{ $t("options.transmission.token_reset") }}
              </LjButton>
            </div>
          </div>
        </div>

        <LjCheckbox
          :model-value="externalRoutesEnabled"
          :label="$t('options.transmission.external_routes')"
          @update:model-value="setExternalRoutes"
        />
        <p v-if="!httpServer.running" class="opt-hint opt-hint--warn">
          {{ $t("options.transmission.server_stopped_hint") }}
        </p>

        <p class="opt-hint opt-hint--info"></p>

        <div>
          <LjCheckbox
            :model-value="useHostname"
            :label="$t('options.transmission.use_hostname')"
            @update:model-value="toggleUseHostname"
          />
          <p class="opt-hint">
            {{
              $t("options.transmission.use_hostname_hint", {
                hostname: hostname || "...",
                port: httpServer.port,
                ip: selectedIp || primaryHost,
              })
            }}
          </p>
        </div>
        <div>
          <LjCheckbox
            :model-value="onlyAuthorizedDevices"
            :label="$t('options.transmission.only_authorized_devices')"
            @update:model-value="toggleOnlyAuthorized"
          />
          <p class="opt-hint">{{ $t("options.transmission.only_authorized_hint") }}</p>
        </div>
      </section>

      <!-- Dispositivos autorizados -->
      <section v-if="httpServer.running && externalRoutesEnabled" class="opt-section">
        <div class="tx-devices-header">
          <h3 class="opt-section-title">
            <LjIcon :icon="ICONS.UI.MONITORS" :size="18" />
            {{ $t("options.transmission.devices_section") }}
          </h3>
          <LjButton size="sm" :icon="ICONS.ACTIONS.ADD" @click="addNewDevice">
            {{ $t("options.transmission.add_device") }}
          </LjButton>
        </div>
        <p class="opt-hint">{{ $t("options.transmission.devices_hint") }}</p>

        <div class="tx-app-download">
          <span class="tx-app-download__label">
            {{ $t("options.transmission.app_download_label") }}
          </span>
          <LjButton size="md" :icon="ICONS.UI.ANDROID" @click="showAppDialog('android')">
            Android
          </LjButton>
          <LjButton size="md" :icon="ICONS.UI.APPLE" @click="showAppDialog('ios')">iOS</LjButton>
        </div>

        <div v-if="devices.length" class="tx-devices">
          <div v-for="device in devices" :key="device.id" class="tx-device-row">
            <div class="tx-device-info">
              <LjIcon :icon="ICONS.UI.MONITORS" :size="18" />
              <div>
                <div class="tx-device-name">{{ device.name }}</div>
                <div class="tx-device-meta">
                  {{ $t("options.transmission.device_platform_label") }}:
                  {{ $t(`options.transmission.platform_${device.platform}`) }}
                  <template v-if="device.model">· {{ device.model }}</template>
                  ·
                  {{
                    device.permissions.map((p) => $t(DEVICE_PERMISSION_LABELS[p])).join(", ") ||
                    $t("options.transmission.no_permissions")
                  }}
                </div>
              </div>
            </div>
            <LjButton size="sm" :icon="ICONS.UI.OPTIONS_OUTLINE" @click="editDevice(device)">
              {{ $t("options.transmission.edit") }}
            </LjButton>
            <LjButton
              size="sm"
              variant="danger"
              :icon="ICONS.ACTIONS.DELETE"
              @click="requestDeleteDevice(device)"
            >
              {{ $t("actions.delete") }}
            </LjButton>
          </div>
        </div>
        <p v-else class="opt-hint">{{ $t("options.transmission.no_devices") }}</p>
      </section>

      <!-- URLs de transmissão (compatibilidade Delphi) -->
      <section v-if="httpServer.running && externalRoutesEnabled" class="opt-section">
        <h3 class="opt-section-title">
          <LjIcon :icon="ICONS.UI.LINK" :size="18" />
          {{ $t("options.transmission.urls_section") }}
        </h3>
        <p class="opt-hint">{{ $t("options.transmission.urls_hint") }}</p>

        <div class="tx-urls">
          <div v-for="link in remoteLinks" :key="link.alias" class="tx-url-row">
            <div class="tx-url-info">
              <div class="tx-url-title">{{ $t(link.titleKey) }}</div>
              <code class="tx-url">{{ remoteUrl(link) }}</code>
            </div>
            <LjButton
              size="sm"
              :icon="ICONS.ACTIONS.COPY"
              @click="copy(remoteUrl(link), link.alias)"
            >
              {{
                copiedKey === link.alias
                  ? $t("options.transmission.copied")
                  : $t("options.transmission.copy")
              }}
            </LjButton>
            <LjButton size="sm" :icon="ICONS.UI.QRCODE" @click="showQrCode(link)">
              {{ $t("options.transmission.qr_code") }}
            </LjButton>
          </div>
        </div>
      </section>

      <!-- Atalhos globais -->
      <section class="opt-section">
        <h3 class="opt-section-title">
          <LjIcon :icon="ICONS.UI.KEYBOARD" :size="18" />
          {{ $t("options.transmission.shortcuts_title") }}
        </h3>
        <LjCheckbox
          :model-value="globalShortcutsEnabled"
          :label="$t('options.transmission.global_shortcuts')"
          @update:model-value="toggleGlobalShortcuts"
        />
        <p class="opt-hint">{{ $t("options.transmission.global_shortcuts_hint") }}</p>
      </section>
    </template>

    <!-- Janelas locais — abre uma view como BrowserWindow -->
    <section class="opt-section">
      <h3 class="opt-section-title">
        <LjIcon :icon="ICONS.UI.WINDOW_RESTORE" :size="18" />
        {{ $t("options.transmission.local_windows") }}
      </h3>
      <p class="opt-hint">{{ $t("options.transmission.local_windows_hint") }}</p>
      <div class="tx-local">
        <div v-for="win in localWindows" :key="win.route" class="tx-local-row">
          <LjIcon :icon="win.icon" :size="18" />
          <div class="tx-local-info">
            <div class="tx-local-title">{{ $t(win.titleKey) }}</div>
          </div>
          <MonitorSelect
            v-if="displays.length"
            inline
            class="tx-local-select"
            :model-value="getPref(featureKey(win.route))"
            @update:model-value="setPref(featureKey(win.route), $event)"
          />
          <LjButton size="sm" :icon="ICONS.UI.MONITORS" @click="openLocalWindow(win)">
            {{ $t("options.transmission.open_window") }}
          </LjButton>
        </div>
      </div>
    </section>
  </div>

  <LjDialog
    v-model="showQrDialog"
    size="sm"
    :icon="ICONS.UI.QRCODE"
    :title="qrTitle ? $t(qrTitle) : ''"
  >
    <div class="qr-body">
      <div ref="qrContainer" class="qr-canvas" />
      <code class="qr-url">{{ qrUrl }}</code>
    </div>
    <template #footer>
      <LjButton size="sm" @click="showQrDialog = false">
        {{ $t("alert.close") }}
      </LjButton>
    </template>
  </LjDialog>

  <!-- QR Code de cadastro de dispositivo -->
  <LjDialog
    v-model="showDeviceQrDialog"
    size="sm"
    :icon="ICONS.UI.QRCODE"
    :title="$t('options.transmission.scan_qr')"
  >
    <div class="qr-body">
      <div ref="deviceQrContainer" class="qr-canvas" />
      <p class="opt-hint" style="margin-top: 8px; text-align: center">
        {{ $t("options.transmission.device_qr_hint") }}
      </p>
      <div class="store-badges">
        <img
          :src="playStoreLogo"
          alt="Play Store"
          class="store-badge"
          @click="showAppDialog('android')"
        />
        <img
          :src="appStoreLogo"
          alt="App Store"
          class="store-badge"
          @click="showAppDialog('ios')"
        />
      </div>
    </div>
    <template #footer>
      <LjButton size="sm" :icon="ICONS.ACTIONS.CLOSE" @click="showDeviceQrDialog = false">
        {{ $t("alert.close") }}
      </LjButton>
    </template>
  </LjDialog>

  <!-- Diálogo de permissões do device -->
  <DevicePermissionsDialog
    :device="dialogDevice"
    :is-pending="isPendingDialog"
    @save="onDeviceSave"
    @reject="onDeviceReject"
    @close="onDeviceDialogClose"
  />

  <!-- Confirmar exclusão de dispositivo -->
  <LjDialog
    size="sm"
    :icon="ICONS.ACTIONS.DELETE"
    :title="$t('options.transmission.remove_confirm_title')"
    :model-value="showConfirmDeleteDialog"
    @update:model-value="onConfirmDeleteDialogClose"
  >
    <template v-if="confirmDeleteDevice">
      <p>{{ $t("options.transmission.remove_confirm_text") }}</p>
      <div class="tx-confirm-device">
        <LjIcon :icon="ICONS.UI.MONITORS" :size="20" />
        <div>
          <div class="tx-confirm-device-name">{{ confirmDeleteDevice.name }}</div>
          <div class="tx-confirm-device-meta">
            {{ $t(`options.transmission.platform_${confirmDeleteDevice.platform}`) }}
            <template v-if="confirmDeleteDevice.model">· {{ confirmDeleteDevice.model }}</template>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <LjButton size="sm" :icon="ICONS.ACTIONS.CANCEL" @click="onConfirmDeleteDialogClose">
        {{ $t("alert.cancel") }}
      </LjButton>
      <LjButton
        size="sm"
        :icon="ICONS.ACTIONS.DELETE"
        variant="danger"
        @click="confirmDeleteDeviceAction"
      >
        {{ $t("actions.delete") }}
      </LjButton>
    </template>
  </LjDialog>

  <!-- Violin Remote — Download da loja -->
  <LjDialog
    v-model="showAppStoreDialog"
    size="sm"
    :icon="appStorePlatform === 'android' ? ICONS.UI.ANDROID : ICONS.UI.APPLE"
    :title="$t('options.transmission.app_dialog_title')"
  >
    <div class="app-store-dialog">
      <p class="app-store-dialog__desc">
        {{ $t("options.transmission.app_dialog_description") }}
      </p>
      <div class="qr-canvas-wrapper">
        <div ref="appStoreQrContainer" class="qr-canvas" />
        <img
          :src="appStorePlatform === 'android' ? playStoreLogo : appStoreLogo"
          class="qr-center-icon"
          alt=""
        />
      </div>
      <a class="app-store-dialog__link" :href="storesUrl" target="_blank" rel="noopener noreferrer">
        {{
          appStorePlatform === "android"
            ? $t("options.transmission.app_dialog_android")
            : $t("options.transmission.app_dialog_ios")
        }}
      </a>
    </div>
    <template #footer>
      <LjButton :icon="ICONS.ACTIONS.CLOSE" size="sm" @click="showAppStoreDialog = false">
        {{ $t("alert.close") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useDisplays } from "@/composables/useDisplays";
import { useDevices } from "@/composables/useDevices";
import $snackbar from "@/helpers/Snackbar";
import MonitorSelect from "@/components/inputs/MonitorSelect.vue";
import DevicePermissionsDialog from "@/components/DevicePermissionsDialog.vue";
import { LjButton, LjCheckbox, LjDialog, LjIcon, LjInput, LjSelect } from "@/components/ui";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { open as openProjection } from "@/helpers/Projection";
import { ICONS } from "@/config/Icons";
import { DEVICE_PERMISSION_LABELS } from "@/types/Device";
import QRCodeStyling from "qr-code-styling";
import logoUrl from "@/assets/img/logo.svg";

const playStoreLogo = new URL("@/assets/img/play-store.svg", import.meta.url).href;
const appStoreLogo = new URL("@/assets/img/app-store.svg", import.meta.url).href;

const isDesktop = computed(() => Platform.isDesktop);
const { t } = useI18n();
const { displays, getFeatureRole, setFeatureRole } = useDisplays();
const {
  devices,
  loadDevices,
  updateDevice,
  removeDevice,
  pendingDevice,
  generatePendingToken,
  acceptPendingDevice,
  rejectPendingDevice,
} = useDevices();

/** Papel de cada janela de transmissão. Carregado sob demanda (passa pelo IPC). */
const featureRoles = ref({});

const FULLSCREEN_ROUTES = [
  "/projection",
  "/projection/return",
  "/projection/bible/return",
  "/obs",
  "/obs/bible",
  "/clock",
];
const FRAMED_ROUTES = ["/operator"];

// Aliases compat-Delphi: mantemos exatamente os mesmos paths que o
// `fmTransmitir.pas` divulgava — assim tutoriais antigos continuam válidos
// e os usuários reconhecem os termos "Transmissão" e "Retorno".
const remoteLinks = [
  { alias: "/controle", titleKey: "options.transmission.remote_control" },
  { alias: "/relogio", titleKey: "options.transmission.win_clock" },
  { alias: "/projecao", titleKey: "options.transmission.win_projection" },
  { alias: "/musica?transmissao", titleKey: "options.transmission.win_music" },
  { alias: "/musica?retorno", titleKey: "options.transmission.win_return" },
  { alias: "/biblia?retorno", titleKey: "options.transmission.win_bible_return" },
  { alias: "/biblia?transmissao", titleKey: "options.transmission.win_bible" },
];

const localWindows = [
  {
    route: "/projection",
    icon: ICONS.UI.MONITOR,
    titleKey: "options.transmission.win_projection",
  },
  {
    route: "/projection/return",
    icon: ICONS.PROJECTION.RETURN,
    titleKey: "options.transmission.win_return",
  },
  {
    route: "/projection/bible/return",
    icon: ICONS.BIBLE.BOOK_OPEN_PAGE,
    titleKey: "options.transmission.win_bible_return",
  },
  {
    route: "/operator",
    icon: ICONS.UI.VIEW_GRID_OUTLINE,
    titleKey: "options.transmission.win_operator",
  },
  {
    route: "/obs",
    icon: ICONS.MEDIA.TELEVISION_PLAY,
    titleKey: "options.transmission.win_music",
  },
  {
    route: "/obs/bible",
    icon: ICONS.BIBLE.BOOK_OPEN,
    titleKey: "options.transmission.win_bible",
  },
  {
    route: "/clock",
    icon: ICONS.MODULES.CLOCK,
    titleKey: "options.transmission.win_clock",
  },
];

const httpServer = ref({ running: false, port: null, token: null });
const httpServerLoading = ref(false);
const httpServerPort = ref(7070);
const externalRoutesEnabled = ref(true);
const localIps = ref([]);
const selectedIp = ref("");
const copiedKey = ref(null);
const globalShortcutsEnabled = ref(false);
const useHostname = ref(false);
const hostname = ref("");
const showQrDialog = ref(false);
const qrUrl = ref("");
const qrTitle = ref("");
const qrContainer = ref(null);
const showDeviceQrDialog = ref(false);
const deviceQrUrl = ref("");
const storeQrUrl = ref("");
const deviceQrContainer = ref(null);
const storeQrContainer = ref(null);
const editingDevice = ref(null);
const confirmDeleteDevice = ref(null);
const showConfirmDeleteDialog = ref(false);
const onlyAuthorizedDevices = ref(false);

const STORES_URLS = {
  android: "https://play.google.com/store/apps/details?id=br.com.louvorja.violin_remote",
  ios: "https://apps.apple.com/app/violin-remote/id6810058446",
};
const showAppStoreDialog = ref(false);
const appStorePlatform = ref("android");
const appStoreQrContainer = ref(null);
const storesUrl = computed(() => STORES_URLS[appStorePlatform.value]);

function showAppDialog(platform) {
  appStorePlatform.value = platform;
  showAppStoreDialog.value = true;
}

// IP "público" preferido — primeiro não-loopback. Cai pra 127.0.0.1
// quando a máquina não tem interface de rede ativa (raro: notebook offline).
const primaryHost = computed(() => {
  return localIps.value.find((ip) => ip !== "127.0.0.1") || "127.0.0.1";
});

// Seletor de IP — persistido em UserData.
// Se o IP salvo não estiver mais na lista de interfaces, volta para o primaryHost.
watch(
  localIps,
  (ips) => {
    if (ips.length && !ips.includes(selectedIp.value)) {
      selectedIp.value = primaryHost.value;
    }
  },
  { immediate: true }
);

watch(selectedIp, (ip) => {
  if (ip) $userdata.set(KEYS.OPTIONS.SELECTED_IP, ip);
});

const baseUrl = computed(() => {
  if (!httpServer.value.running) return "";
  const h =
    useHostname.value && hostname.value.trim()
      ? hostname.value.trim()
      : selectedIp.value || primaryHost.value;
  return `http://${h}:${httpServer.value.port}`;
});

function featureKey(route) {
  return `transmission:${route}`;
}
function getPref(feature) {
  if (featureRoles.value[feature] === undefined) {
    featureRoles.value[feature] = "";
    getFeatureRole(feature).then((role) => {
      featureRoles.value = { ...featureRoles.value, [feature]: role ?? "" };
    });
  }
  return featureRoles.value[feature];
}
function setPref(feature, role) {
  featureRoles.value = { ...featureRoles.value, [feature]: role };
  setFeatureRole(feature, role || null);
}

function remoteUrl(link) {
  if (!httpServer.value.running) return "";
  const url = `${baseUrl.value}${link.alias}`;
  if (!httpServer.value.token) return url;
  // Aliases Delphi sempre têm `?` (`?transmissao`, `?retorno`).
  const sep = link.alias.includes("?") ? "&" : "?";
  return `${url}${sep}token=${httpServer.value.token}`;
}

async function copy(text, key) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    setTimeout(() => {
      copiedKey.value = null;
    }, 2000);
  } catch {
    /* clipboard pode estar bloqueado — ignora silenciosamente */
  }
}

function showQrCode(link) {
  const url = remoteUrl(link);
  if (!url) return;
  qrUrl.value = url;
  qrTitle.value = link.titleKey;
  showQrDialog.value = true;
}

// O corpo do diálogo é emitido num portal, então o canvas só existe depois que
// o conteúdo monta: o desenho fica preso à referência (e à URL, para o caso de
// abrir outro link com o diálogo já montado), não a um tick após abrir.
watch(
  [qrContainer, qrUrl],
  async ([container, url]) => {
    if (!container || !url) return;
    try {
      const qr = new QRCodeStyling({
        width: 240,
        height: 240,
        type: "canvas",
        data: url,
        image: logoUrl,
        dotsOptions: {
          type: "rounded",
          color: "#000",
        },
        cornersSquareOptions: {
          type: "rounded",
        },
        backgroundOptions: {
          color: "#fff",
        },
        imageOptions: {
          crossOrigin: "anonymous",
          margin: 10,
        },
      });
      qr.append(container);
    } catch (e) {
      console.error("[Transmitir] QRCode:", e);
    }
  },
  { flush: "post" }
);

// --- Dispositivos ---
async function addNewDevice() {
  const token = generatePendingToken();
  if (!token) return;
  const host =
    useHostname.value && hostname.value.trim()
      ? hostname.value.trim()
      : selectedIp.value || primaryHost.value;

  deviceQrUrl.value = `violin-remote://register?token=${token}&host=${encodeURIComponent(host)}&port=${httpServer.value.port}`;
  showDeviceQrDialog.value = true;
}

/** Device sendo editado — pending (recém-cadastrado) ou existente. */
const dialogDevice = computed(() => pendingDevice.value || editingDevice.value);
const isPendingDialog = computed(() => !!pendingDevice.value);

function editDevice(device) {
  editingDevice.value = device;
}

async function onDeviceSave(id, name, permissions) {
  if (isPendingDialog.value && pendingDevice.value?.id === id) {
    // Device pendente — aceitar com permissões definidas
    await acceptPendingDevice(name, permissions);
  } else {
    // Device existente — atualizar
    await updateDevice(id, { name, permissions });
  }
  editingDevice.value = null;
}

async function onDeviceReject(id) {
  if (isPendingDialog.value && pendingDevice.value?.id === id) {
    await rejectPendingDevice();
  } else {
    await removeDevice(id);
  }
  editingDevice.value = null;
}

function onDeviceDialogClose() {
  editingDevice.value = null;
}

function onConfirmDeleteDialogClose() {
  showConfirmDeleteDialog.value = false;
  setTimeout(() => {
    confirmDeleteDevice.value = null;
  }, 250);
}

function requestDeleteDevice(device) {
  confirmDeleteDevice.value = device;
  showConfirmDeleteDialog.value = true;
}

async function confirmDeleteDeviceAction() {
  if (!confirmDeleteDevice.value) return;
  await removeDevice(confirmDeleteDevice.value.id);
  showConfirmDeleteDialog.value = false;
  setTimeout(() => {
    confirmDeleteDevice.value = null;
  }, 250);
}

watch(pendingDevice, (val) => {
  if (val) showDeviceQrDialog.value = false;
});

watch(
  [deviceQrContainer, deviceQrUrl],
  async ([container, url]) => {
    if (!container || !url) return;
    try {
      const qr = new QRCodeStyling({
        width: 240,
        height: 240,
        type: "canvas",
        data: url,
        image: logoUrl,
        dotsOptions: {
          type: "rounded",
          color: "#000",
        },
        cornersSquareOptions: {
          type: "rounded",
        },
        backgroundOptions: {
          color: "#fff",
        },
        imageOptions: {
          crossOrigin: "anonymous",
          margin: 10,
        },
      });
      qr.append(container);
    } catch (e) {
      console.error("[Transmitir] QRCode device:", e);
    }
  },
  { flush: "post" }
);

// QR Code da loja (Play Store / App Store)
watch([storeQrContainer, storeQrUrl], async ([container, url]) => {
  if (!container || !url) return;
  try {
    const qr = new QRCodeStyling({
      width: 240,
      height: 240,
      type: "canvas",
      data: url,
      dotsOptions: {
        type: "rounded",
        color: "#000",
      },
      backgroundOptions: { color: "transparent" },
      cornersOptions: { type: "extra-rounded" },
    });
    container.innerHTML = "";
    qr.append(container);
  } catch (e) {
    console.error("QRCode rendering error:", e);
  }
});

// QR Code — Violin Remote (loja)
watch(
  [appStoreQrContainer, storesUrl, appStorePlatform],
  async ([container, url]) => {
    if (!container || !url) return;
    container.innerHTML = "";
    try {
      const qr = new QRCodeStyling({
        width: 240,
        height: 240,
        type: "canvas",
        data: url,
        dotsOptions: {
          type: "rounded",
          color: "#000",
        },
        cornersSquareOptions: {
          type: "rounded",
        },
        backgroundOptions: {
          color: "#fff",
        },
      });
      qr.append(container);
    } catch (e) {
      console.error("[Transmitir] QRCode store:", e);
    }
  },
  { flush: "post" }
);

async function toggleHttpServer() {
  if (!Platform.httpServer) return;
  httpServerLoading.value = true;
  try {
    if (httpServer.value.running) await Platform.httpServer.stop();
    else await Platform.httpServer.start({ port: httpServerPort.value });
    await refreshStatus();
  } catch (e) {
    console.error("[Transmitir] toggle:", e);
  } finally {
    httpServerLoading.value = false;
  }
}

async function resetToken() {
  if (!Platform.httpServer?.resetToken) return;
  try {
    await Platform.httpServer.resetToken();
    await refreshStatus();
  } catch (e) {
    console.error("[Transmitir] resetToken:", e);
  }
}

const tokenInput = ref("");

watch(
  () => httpServer.value.token,
  (t) => {
    tokenInput.value = t || "";
  },
  { immediate: true }
);

async function saveToken() {
  if (!Platform.httpServer?.setToken) return;
  const val = tokenInput.value.trim();
  if (!val) return;
  try {
    await Platform.httpServer.setToken(val);
    await refreshStatus();
    $snackbar.success(t("options.transmission.token_saved"));
  } catch (e) {
    console.error("[Transmitir] saveToken:", e);
  }
}

function copyToken() {
  navigator.clipboard?.writeText(tokenInput.value);
  $snackbar.success(t("options.transmission.token_copied"));
}

/**
 * Alterna a permissão de rotas externas (SSE, API, aliases Delphi).
 * Quando desativadas, apenas localhost pode acessá-las; a SPA do app
 * continua disponível de qualquer origem para que YouTube e Broadcast
 * Channel entre janelas Electron funcionem.
 */
async function setExternalRoutes(enabled) {
  externalRoutesEnabled.value = enabled;
  if (!Platform.httpServer?.setExternalRoutes) return;
  try {
    await Platform.httpServer.setExternalRoutes(enabled);
  } catch (e) {
    console.error("[Transmitir] setExternalRoutes:", e);
  }
}

async function refreshStatus() {
  if (!Platform.httpServer) return;
  try {
    const s = await Platform.httpServer.status();
    httpServer.value = s;
    externalRoutesEnabled.value = s.externalRoutesEnabled !== false;
  } catch {
    httpServer.value = { running: false, port: null, token: null };
    externalRoutesEnabled.value = false;
  }
  httpServerLoading.value = false;
  try {
    localIps.value = await Platform.httpServer.localIps();
  } catch {
    /* noop */
  }
}

async function setHttpServerPort(port) {
  httpServerPort.value = port;
  if (!Platform.userStore) return;
  try {
    const cfg = (await Platform.userStore.read("config")) || {};
    if (!cfg.httpServer) cfg.httpServer = {};
    cfg.httpServer.port = port;
    await Platform.userStore.write("config", cfg);
  } catch (e) {
    console.warn("[Transmitir] setPort:", e);
  }
}

async function openLocalWindow(win) {
  const { route } = win;
  const fullscreen = FULLSCREEN_ROUTES.some((r) => route.startsWith(r));
  await openProjection({
    route,
    feature: featureKey(route),
    fullscreen,
    frame: FRAMED_ROUTES.some((r) => route.startsWith(r)),
    monitorId: getPref(featureKey(route)) ?? null,
  });
}

async function toggleGlobalShortcuts(enabled) {
  globalShortcutsEnabled.value = enabled;
  if (!Platform.shortcuts) return;
  try {
    if (enabled) await Platform.shortcuts.enable();
    else await Platform.shortcuts.disable();
    await Platform.shortcuts.savePreference(enabled);
  } catch (e) {
    console.error("[Transmitir] shortcuts:", e);
  }
}

async function toggleOnlyAuthorized(enabled) {
  onlyAuthorizedDevices.value = enabled;
  if (!Platform.httpServer?.setDeviceSettings) return;
  try {
    await Platform.httpServer.setDeviceSettings({ only_authorized_devices: enabled });
  } catch (e) {
    console.error("[Transmitir] setDeviceSettings:", e);
  }
}

async function toggleUseHostname(enabled) {
  useHostname.value = enabled;
  if (!Platform.userStore) return;
  try {
    const cfg = (await Platform.userStore.read("config")) || {};
    if (!cfg.httpServer) cfg.httpServer = {};
    cfg.httpServer.useHostname = enabled;
    await Platform.userStore.write("config", cfg);
  } catch (e) {
    console.warn("[Transmitir] useHostname:", e);
  }
}

onMounted(async () => {
  if (!isDesktop.value) return;
  if (Platform.httpServer) {
    try {
      await refreshStatus();
      const cfg = (await Platform.userStore?.read("config")) || {};
      httpServerPort.value = cfg.httpServer?.port ?? 7070;
      useHostname.value = cfg.httpServer?.useHostname ?? false;
      hostname.value = await Platform.httpServer.hostname();
      const savedIp = String($userdata.get(KEYS.OPTIONS.SELECTED_IP, ""));
      selectedIp.value = savedIp && localIps.value.includes(savedIp) ? savedIp : primaryHost.value;
      if (Platform.httpServer.getDeviceSettings) {
        const ds = await Platform.httpServer.getDeviceSettings();
        onlyAuthorizedDevices.value = ds.only_authorized_devices === true;
      }
    } catch (e) {
      console.warn("[Transmitir] init:", e);
    }
  }
  // Recarrega dispositivos no mount — garante que a lista está atualizada
  // mesmo que o load singleton anterior tenha falhado.
  loadDevices().catch(() => {});
  if (Platform.shortcuts) {
    try {
      const s = await Platform.shortcuts.status();
      globalShortcutsEnabled.value = s.enabled;
    } catch (e) {
      console.warn("[Transmitir] shortcuts init:", e);
    }
  }
});
</script>

<style scoped>
/* Legenda ao lado do título da seção: contexto que não compete com o título. */
.tx-title-hint {
  margin-left: var(--lj-space-7);
  font-size: var(--lj-text-sm);
  font-style: italic;
  font-weight: var(--lj-weight-regular);
  color: var(--lj-text-subtle);
}

/* Status do servidor: bullet + url/legenda + botão alinhados em uma linha. */
.tx-status {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  margin-bottom: var(--lj-space-4);
}
.tx-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lj-text-subtle);
  flex-shrink: 0;
}
.tx-dot--on {
  background: var(--lj-success);
  box-shadow: 0 0 0 3px var(--lj-success-soft);
}
.tx-status-url {
  font-family: var(--lj-font-mono);
  flex: 1;
  word-break: break-all;
}
.tx-status-text {
  flex: 1;
  color: var(--lj-text-muted);
}

.tx-token-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  margin: var(--lj-space-3) 0;
}
.tx-token-label {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
}
.tx-token-input {
  font-family: var(--lj-font-mono);
  letter-spacing: 0.08em;
  padding: var(--lj-space-1) var(--lj-space-4);
  background: var(--lj-surface-bg-active);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  color: var(--lj-text);
  outline: none;
  width: 100px;
  transition: border-color 150ms;
}
.tx-token-input:focus {
  border-color: var(--lj-accent);
}
.tx-port-label {
  margin-left: var(--lj-space-8);
}
.tx-port {
  display: inline-flex;
  flex: none;
  width: 92px;
}
.tx-port :deep(.lj-input) {
  width: 100%;
}
.tx-port :deep(.lj-input__field) {
  text-align: center;
}

/* Lista de URLs de transmissão. */
/* Dispositivos autorizados */
.tx-devices-header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}
.tx-devices-header .opt-section-title {
  flex: 1;
  margin-bottom: 0;
}
.tx-devices {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}
.tx-device-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg-hover);
  border-radius: var(--lj-radius-lg);
}
.tx-device-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}
.tx-device-name {
  font-weight: var(--lj-weight-medium);
  font-size: var(--lj-text-sm);
}
.tx-device-meta {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-subtle);
}

.tx-urls {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}
.tx-url-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
  background: var(--lj-surface-bg-hover);
  border-radius: var(--lj-radius-lg);
}
.tx-url-info {
  flex: 1;
  min-width: 0;
}
.tx-url-title {
  font-weight: var(--lj-weight-medium);
  margin-bottom: var(--lj-space-1);
}
.tx-url {
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-md);
  color: var(--lj-text-muted);
  word-break: break-all;
  display: block;
}

/* Janelas locais — linha mais compacta. */
.tx-local {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}
.tx-local-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-2) 0;
}
.tx-local-info {
  flex: 1;
}
.tx-local-title {
  font-size: var(--lj-text-lg);
}
.tx-local-select {
  max-width: 180px;
}

/* Corpo do diálogo de QR Code — o cabeçalho e o rodapé são do LjDialog. */
.qr-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-5);
}
.qr-canvas {
  border-radius: var(--lj-radius-lg);
  max-width: 100%;
}
.qr-canvas-wrapper {
  position: relative;
  display: inline-flex;
}
.qr-center-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: #fff;
  padding: 4px;
}
.qr-url {
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  word-break: break-all;
  text-align: center;
  max-width: 100%;
}
.tx-confirm-device {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg-hover);
  border-radius: var(--lj-radius-lg);
  margin-top: var(--lj-space-3);
}
.tx-confirm-device-name {
  font-weight: var(--lj-weight-medium);
  font-size: var(--lj-text-sm);
}
.tx-confirm-device-meta {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-subtle);
}

.tx-devices-header__actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
}

.tx-app-download {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  margin-bottom: var(--lj-space-5);
}
.tx-app-download__label {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text-muted);
}

.app-store-dialog {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-4);
  text-align: center;
}
.app-store-dialog__desc {
  color: var(--lj-text);
  line-height: 1.5;
}
.app-store-dialog__link {
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-ui-accent);
  font-size: var(--lj-text-sm);
  text-decoration: none;
  cursor: pointer;
}
.app-store-dialog__link:hover {
  text-decoration: underline;
}

.store-badges {
  display: flex;
  justify-content: center;
  gap: 50px;
  margin-top: 12px;
}
.store-badge {
  height: 32px;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.2s;
}
.store-badge:hover {
  opacity: 1;
}
</style>
