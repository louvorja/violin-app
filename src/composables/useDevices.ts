/**
 * useDevices — Composable para gerenciar dispositivos autorizados.
 *
 * Fornece CRUD de devices com persistência via IPC devices:*.
 * Estado reativo é um singleton (mesmo em múltiplas instâncias).
 *
 * Uso:
 *   const { devices, loadDevices, addDevice, updateDevice, removeDevice } = useDevices();
 */

import { ref, onBeforeUnmount } from "vue";
import type { Device, DevicePermission } from "@/types/Device";
import Platform from "@/helpers/Platform";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";

const DEVICE_IDB_KEY = "authorized_devices";

const _devices = ref<Device[]>([]);
const _loaded = ref(false);
const _pendingToken = ref<string | null>(null);
const _pendingDevice = ref<Device | null>(null);

/** Cleanup singleton — protege contra listeners duplicados. */
let _listenersAttached = false;
let _cleanup: (() => void) | null = null;
let _cleanupPending: (() => void) | null = null;

/**
 * Fallback: qualquer device cadastrado sem permissões é tratado como
 * pendente. Garante que a tela de permissões abra mesmo quando o evento
 * `devices:pending` se perdeu (janela recriada, renderer sem listener, etc.).
 */
function _syncPendingFromList(list: Device[]) {
  if (_pendingDevice.value) return;
  const orphan = list.find((d) => !d.permissions || d.permissions.length === 0);
  if (orphan) {
    console.log("[useDevices] device sem permissões detectado:", orphan.name);
    _pendingDevice.value = orphan;
  }
}

function _getApi() {
  return Platform.devices as {
    list?: () => Promise<Device[]>;
    save?: (devices: Device[]) => Promise<void>;
    onChanged?: (cb: (list: Device[]) => void) => () => void;
    onPending?: (cb: (device: Device) => void) => () => void;
  } | null;
}

function _attachListeners() {
  if (_listenersAttached) return;
  _listenersAttached = true;

  const api = _getApi();

  console.log("[useDevices] _attachListeners Platform.devices:", !!api, "onPending:", !!api?.onPending, "onChanged:", !!api?.onChanged);

  if (api?.onChanged) {
    _cleanup = api.onChanged((list: Device[]) => {
      console.log("[useDevices] onChanged:", list?.length, "devices");
      _devices.value = Array.isArray(list) ? list : [];
      _syncPendingFromList(_devices.value);
    });
  }
  if (api?.onPending) {
    _cleanupPending = api.onPending((device: Device) => {
      console.log("[useDevices] onPending:", device?.name, device?.platform);
      _pendingDevice.value = device;
    });
  }
}

/**
 * Lê devices do IndexedDB e envia ao main process.
 * Pode ser chamado de qualquer contexto (boot do renderer, mount de componente).
 */
async function syncFromIdb(): Promise<void> {
  try {
    const row = await $idb.get<{ id: string; devices: Device[] }>(DB_TABLE.DEVICES, DEVICE_IDB_KEY);
    const list = row?.devices;
    console.log("[useDevices] syncFromIdb:", list?.length ?? 0, "devices");
    _devices.value = Array.isArray(list) ? list : [];
    _loaded.value = true;
    _syncPendingFromList(_devices.value);
    // Envia para main process (cache em memória para auth middleware).
    const api = _getApi();
    if (api?.save) {
      const plain = JSON.parse(JSON.stringify(_devices.value));
      await api.save(plain);
    }
  } catch (e) {
    console.error("[useDevices] syncFromIdb:", e);
  }
}

export { syncFromIdb };

export function useDevices() {
  // Garante que os listeners estão ativos (singleton, only-once).
  _attachListeners();

  // Cleanup no unmount — registra no primeiro componente que usar.
  onBeforeUnmount(() => {
    // Só remove se não houver mais componentes usando.
    // Em prática, como é singleton no renderer, keep alive.
  });

  /**
   * Recarrega devices do IndexedDB e sincroniza com main process.
   */
  async function loadDevices(): Promise<void> {
    await syncFromIdb();
  }

  /**
   * Sincroniza a lista atual com o main process (cache em memória).
   */
  async function _syncToMainProcess(): Promise<void> {
    if (!Platform.devices) return;
    try {
      const plain = JSON.parse(JSON.stringify(_devices.value));
      await Platform.devices.save(plain);
    } catch (e) {
      console.error("[useDevices] sync to main:", e);
    }
  }

  /**
   * Persiste no IndexedDB e sincroniza com main process.
   */
  async function _sync(): Promise<void> {
    try {
      const plain = JSON.parse(JSON.stringify(_devices.value));
      await $idb.put<{ id: string; devices: Device[] }>(DB_TABLE.DEVICES, {
        id: DEVICE_IDB_KEY,
        devices: plain,
      });
    } catch (e) {
      console.error("[useDevices] sync IndexedDB:", e);
    }
    await _syncToMainProcess();
  }

  /**
   * Adiciona um novo dispositivo com permissões.
   */
  async function addDevice(
    info: Omit<Device, "id" | "registeredAt"> & { id?: string }
  ): Promise<Device> {
    const device: Device = {
      id: info.id || crypto.randomUUID(),
      token: info.token,
      name: info.name,
      platform: info.platform,
      registeredAt: new Date().toISOString(),
      permissions: info.permissions || [],
    };
    _devices.value = [..._devices.value, device];
    await _sync();
    return device;
  }

  /**
   * Atualiza um dispositivo existente (nome, permissões).
   */
  async function updateDevice(
    id: string,
    patch: Partial<Pick<Device, "name" | "permissions">>
  ): Promise<void> {
    _devices.value = _devices.value.map((d) =>
      d.id === id ? { ...d, ...patch } : d
    );
    await _sync();
  }

  /**
   * Remove um dispositivo da lista.
   */
  async function removeDevice(id: string): Promise<void> {
    _devices.value = _devices.value.filter((d) => d.id !== id);
    await _sync();
  }

  /**
   * Gera um token para exibir no QR code de cadastro.
   */
  function generatePendingToken(): string {
    const token = crypto.randomUUID();
    _pendingToken.value = token;
    return token;
  }

  /**
   * Verifica se um device tem uma permissão específica.
   */
  function hasPermission(deviceId: string, perm: DevicePermission): boolean {
    const device = _devices.value.find((d) => d.id === deviceId);
    if (!device) return false;
    return device.permissions.includes("root") || device.permissions.includes(perm);
  }

  /**
   * Aceita o device pendente (define permissões e salva).
   *
   * O device já existe na lista (foi gravado pelo main no
   * `POST /api/register-device`), então aqui ele é ATUALIZADO — não
   * duplicado. O append só vale como fallback caso a lista local ainda
   * não tenha recebido o `devices:changed`.
   */
  async function acceptPendingDevice(
    name: string,
    permissions: DevicePermission[]
  ): Promise<Device | null> {
    if (!_pendingDevice.value) return null;
    const device = _pendingDevice.value;
    const updated: Device = { ...device, name, permissions };
    const exists = _devices.value.some((d) => d.id === device.id);
    _devices.value = exists
      ? _devices.value.map((d) => (d.id === device.id ? updated : d))
      : [..._devices.value, updated];
    _pendingDevice.value = null;
    _pendingToken.value = null;
    await _sync();
    return updated;
  }

  /**
   * Rejeita o device pendente (remove da lista).
   */
  async function rejectPendingDevice(): Promise<void> {
    if (!_pendingDevice.value) return;
    const id = _pendingDevice.value.id;
    _devices.value = _devices.value.filter((d) => d.id !== id);
    _pendingDevice.value = null;
    await _sync();
  }

  return {
    /** Lista reativa de dispositivos autorizados. */
    devices: _devices,
    /** true após o primeiro load. */
    loaded: _loaded,
    /** Token pendente (device escaneou QR mas ainda não definiu permissões). */
    pendingToken: _pendingToken,
    /** Device pendente aguardando definição de permissões. */
    pendingDevice: _pendingDevice,
    loadDevices,
    addDevice,
    updateDevice,
    removeDevice,
    acceptPendingDevice,
    rejectPendingDevice,
    generatePendingToken,
    hasPermission,
  };
}
