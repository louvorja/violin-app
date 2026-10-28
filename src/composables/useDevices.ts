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

/**
 * Id do registro agregado do formato ANTIGO da tabela (`authorized_devices`
 * com o array de dispositivos dentro). Só existe para a migração.
 *
 * TODO: remover a migração do formato antigo no próximo release — roteiro em
 * `docs/devices-idb-migration-removal.md`.
 */
const ID_REGISTRO_ANTIGO = "authorized_devices";

const _devices = ref<Device[]>([]);
const _loaded = ref(false);
const _pendingToken = ref<string | null>(null);
const _pendingDevice = ref<Device | null>(null);

/** Cleanup singleton — protege contra listeners duplicados. */
let _listenersAttached = false;
let _cleanup: (() => void) | null = null;
let _cleanupPending: (() => void) | null = null;

/** Linha do formato antigo: um registro só, com os dispositivos dentro. */
interface RegistroAgregado {
  id: string;
  devices?: unknown;
}

/** `true` quando a linha é o registro agregado antigo. */
function _ehRegistroAgregado(row: unknown): row is RegistroAgregado & { devices: Device[] } {
  const linha = row as RegistroAgregado | null;
  return (
    !!linha &&
    typeof linha === "object" &&
    linha.id === ID_REGISTRO_ANTIGO &&
    Array.isArray(linha.devices)
  );
}

/**
 * Autorizado = não é pendente. Registro sem `status` é anterior ao campo, e a
 * pendência dele é inferida pelo `_ehPendente` — persistir não o autoriza.
 */
function _ehAutorizado(device: Device): boolean {
  return device.status !== "pending";
}

/**
 * Até a beta.17, todo aparelho aprovado usava o módulo Atalhos do app; a
 * permissão `keyboard` passou a ser exigida depois. Quem vem do formato antigo
 * a herda, para os atalhos não pararem no meio de um culto ao atualizar. O
 * operador pode tirá-la depois, e aparelho novo começa sem ela.
 */
function _comAtalhosHerdados(device: Device): Device {
  const perms = device.permissions || [];
  if (!_ehAutorizado(device) || !perms.length) return device;
  if (perms.includes("root") || perms.includes("keyboard")) return device;
  return { ...device, permissions: [...perms, "keyboard"] };
}

/** Mais antigo primeiro; sem data vai para o começo. */
function _porRegistro(a: Device, b: Device): number {
  return String(a.registeredAt || "").localeCompare(String(b.registeredAt || ""));
}

/**
 * Tabela `devices`: UM registro por dispositivo, com a chave sendo o `id`.
 *
 * O banco guarda só dispositivo AUTORIZADO — recusado e removido são apagados,
 * e pendente não chega a ser gravado. Era um único registro agregado que um
 * `_sync` reescrevia inteiro a cada mudança; agora cada operação grava (ou
 * apaga) só o que mudou.
 *
 * A migração do agregado roda na primeira leitura e cobre os dois caminhos que
 * ainda podem trazê-lo: banco instalado por versão anterior e backup antigo
 * restaurado (o import recarrega a janela, então a leitura acontece em seguida).
 *
 * TODO: remover a migração logo abaixo no próximo release — roteiro em
 * `docs/devices-idb-migration-removal.md`.
 *
 * @returns todos os dispositivos que estavam gravados, na ordem de cadastro
 */
async function _lerDispositivos(): Promise<Device[]> {
  const rows = await $idb.getAll<RegistroAgregado | Device>(DB_TABLE.DEVICES);
  const agregados = rows.filter(_ehRegistroAgregado);
  const dasLinhas = rows.filter((row) => !_ehRegistroAgregado(row)) as Device[];
  const doAgregado = agregados.flatMap((linha) => (linha.devices as Device[]).map(_comAtalhosHerdados));
  const todos = [...dasLinhas, ...doAgregado];

  if (agregados.length) {
    console.log("[useDevices] migrando registro agregado:", doAgregado.length, "devices");
  }

  /*
   * Pendente não mora no banco. Um que tenha ficado lá (versão anterior gravava
   * a lista inteira) sai da tabela, mas continua na memória — a tela de
   * aprovação abre uma última vez em vez de deixar o aparelho órfão.
   */
  const pendentesPersistidos = todos.filter((d) => !_ehAutorizado(d));
  if (agregados.length || pendentesPersistidos.length) {
    try {
      await $idb.putMany(
        DB_TABLE.DEVICES,
        todos.filter(_ehAutorizado),
        [ID_REGISTRO_ANTIGO, ...pendentesPersistidos.map((d) => d.id)]
      );
    } catch (e) {
      console.error("[useDevices] migração do IndexedDB:", e);
    }
  }

  return todos.sort(_porRegistro);
}

/** Grava UM dispositivo. Pendente não vai para o banco: lá só mora autorizado. */
async function _persistirDispositivo(device: Device): Promise<void> {
  if (!_ehAutorizado(device)) return;
  try {
    const plain = JSON.parse(JSON.stringify(device)) as Device;
    await $idb.put<Device>(DB_TABLE.DEVICES, plain);
  } catch (e) {
    console.error("[useDevices] persist device:", e);
  }
}

/** Apaga a linha de um dispositivo. Id sem linha é no-op (recusa de pendente). */
async function _apagarDispositivo(id: string): Promise<void> {
  try {
    await $idb.del(DB_TABLE.DEVICES, id);
  } catch (e) {
    console.error("[useDevices] delete device:", e);
  }
}

/**
 * Este device está esperando o operador definir as permissões?
 *
 * Pendência é estado explícito (`status`). A inferência antiga — "sem permissões
 * = pendente" — quebrava o fluxo normal: salvar um dispositivo sem NENHUMA
 * permissão o devolvia para a tela de aprovação, porque o `devices:changed`
 * do save reavaliava a lista inteira. Sem permissão significa **inerte** (o
 * servidor recusa o acesso), que é outra coisa.
 *
 * A exceção é o registro antigo, anterior ao campo `status`: não marcar nada
 * deixaria para sempre um aparelho que chegou antes da mudança esperando
 * aprovação que ninguém veria.
 */
function _ehPendente(d: Device): boolean {
  if (d.status) return d.status === "pending";
  return !d.permissions || d.permissions.length === 0;
}

/**
 * Recupera o device pendente a partir da lista.
 *
 * Garante que a tela de permissões abra mesmo quando o evento `devices:pending`
 * se perdeu (janela recriada, renderer sem listener, etc.).
 */
function _syncPendingFromList(list: Device[]) {
  if (_pendingDevice.value) return;
  const orphan = list.find(_ehPendente);
  if (orphan) {
    console.log("[useDevices] device pendente detectado:", orphan.name);
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

  console.log(
    "[useDevices] _attachListeners Platform.devices:",
    !!api,
    "onPending:",
    !!api?.onPending,
    "onChanged:",
    !!api?.onChanged
  );

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
    const lista = await _lerDispositivos();
    console.log("[useDevices] syncFromIdb:", lista.length, "devices");
    _devices.value = lista;
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
   *
   * O main recebe a lista COMPLETA, pendentes incluídos: é ela que o auth usa
   * para reconhecer o par id+token de um aparelho ainda sem permissões (e
   * liberar `/api/ping` enquanto o operador decide).
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
      /* Nasce adicionado pelo operador, com as permissões que ele escolheu. */
      status: "approved" as const,
    };
    _devices.value = [..._devices.value, device];
    await _persistirDispositivo(device);
    await _syncToMainProcess();
    return device;
  }

  /**
   * Atualiza um dispositivo existente (nome, permissões).
   */
  async function updateDevice(
    id: string,
    patch: Partial<Pick<Device, "name" | "permissions">>
  ): Promise<void> {
    const atual = _devices.value.find((d) => d.id === id);
    if (!atual) return;
    const atualizado: Device = { ...atual, ...patch, status: "approved" as const };
    _devices.value = _devices.value.map((d) => (d.id === id ? atualizado : d));
    await _persistirDispositivo(atualizado);
    await _syncToMainProcess();
  }

  /**
   * Remove um dispositivo da lista.
   */
  async function removeDevice(id: string): Promise<void> {
    _devices.value = _devices.value.filter((d) => d.id !== id);
    await _apagarDispositivo(id);
    await _syncToMainProcess();
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
    const updated: Device = { ...device, name, permissions, status: "approved" };
    const exists = _devices.value.some((d) => d.id === device.id);
    _devices.value = exists
      ? _devices.value.map((d) => (d.id === device.id ? updated : d))
      : [..._devices.value, updated];
    _pendingDevice.value = null;
    _pendingToken.value = null;
    /* A aprovação é o que coloca a linha no banco. */
    await _persistirDispositivo(updated);
    await _syncToMainProcess();
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
    await _apagarDispositivo(id);
    await _syncToMainProcess();
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
