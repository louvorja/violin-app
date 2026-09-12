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

const _devices = ref<Device[]>([]);
const _loaded = ref(false);
const _pendingToken = ref<string | null>(null);
const _pendingDevice = ref<Device | null>(null);

/** Cleanup singleton — protege contra listeners duplicados. */
let _listenersAttached = false;
let _cleanup: (() => void) | null = null;
let _cleanupPending: (() => void) | null = null;

function _attachListeners() {
  if (_listenersAttached) return;
  _listenersAttached = true;

  const api = Platform.devices as {
    list?: () => Promise<Device[]>;
    save?: (devices: Device[]) => Promise<void>;
    onChanged?: (cb: (list: Device[]) => void) => () => void;
    onPending?: (cb: (device: Device) => void) => () => void;
  } | null;

  console.log("[useDevices] _attachListeners Platform.devices:", !!api, "onPending:", !!api?.onPending, "onChanged:", !!api?.onChanged);

  if (api?.onChanged) {
    _cleanup = api.onChanged((list: Device[]) => {
      console.log("[useDevices] onChanged:", list?.length, "devices");
      _devices.value = Array.isArray(list) ? list : [];
    });
  }
  if (api?.onPending) {
    _cleanupPending = api.onPending((device: Device) => {
      console.log("[useDevices] onPending:", device?.name, device?.platform);
      _pendingDevice.value = device;
    });
  }

  // Carrega a lista inicial do main process (devices.json).
  if (api?.list && !_loaded.value) {
    api.list().then((list) => {
      console.log("[useDevices] load inicial:", list?.length, "devices");
      _devices.value = Array.isArray(list) ? list : [];
      _loaded.value = true;
    }).catch((e) => {
      console.error("[useDevices] load inicial:", e);
    });
  }
}

export function useDevices() {
  // Garante que os listeners estão ativos (singleton, only-once).
  _attachListeners();

  // Cleanup no unmount — registra no primeiro componente que usar.
  onBeforeUnmount(() => {
    // Só remove se não houver mais componentes usando.
    // Em prática, como é singleton no renderer, keep alive.
  });

  /**
   * Carrega a lista de dispositivos do main process.
   */
  async function loadDevices(): Promise<void> {
    if (!Platform.devices) return;
    try {
      const list = await Platform.devices.list();
      _devices.value = Array.isArray(list) ? list : [];
      _loaded.value = true;
    } catch (e) {
      console.error("[useDevices] load:", e);
    }
  }

  /**
   * Sincroniza a lista atual com o main process.
   */
  async function _sync(): Promise<void> {
    if (!Platform.devices) return;
    try {
      const plain = JSON.parse(JSON.stringify(_devices.value));
      await Platform.devices.save(plain);
    } catch (e) {
      console.error("[useDevices] sync:", e);
    }
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
   */
  async function acceptPendingDevice(
    name: string,
    permissions: DevicePermission[]
  ): Promise<Device | null> {
    if (!_pendingDevice.value) return null;
    const device = _pendingDevice.value;
    const updated: Device = { ...device, name, permissions };
    _devices.value = [..._devices.value, updated];
    _pendingDevice.value = null;
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
