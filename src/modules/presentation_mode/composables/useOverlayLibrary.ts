import { onActivated, onMounted, ref } from "vue";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import $userdata from "@/helpers/UserData";
import { readAllSlots, writeSlot } from "@/helpers/Overlay";
import { KEYS } from "@/constants/UserDataKeys";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { OVERLAY_STYLE_DEFAULTS, type OverlaySlot } from "@/types/Overlay";

/**
 * Sobreposições do módulo Overlay na biblioteca do Modo apresentação.
 *
 * Ativar aqui é o mesmo que ligar o slot no módulo: grava `slot.enabled`, liga
 * a chave geral quando necessário e avisa as projeções pelo broadcast que o
 * main-shell completa com `overlay_epoch`. Por isso a escolha do operador
 * sobrevive a reabrir o app.
 */
export function useOverlayLibrary() {
  const slots = ref<OverlaySlot[]>([]);
  const loading = ref(true);
  const failed = ref(false);
  // O interruptor geral já nasce com o valor salvo; a leitura dos slots é que
  // é assíncrona. Sem isto, o cabeçalho pisca "desligado" ao abrir a aba.
  const enabled = ref($userdata.get<boolean>(KEYS.MODULES.OVERLAY.ENABLED, false) === true);
  let generation = 0;
  const pending = new Set<string>();

  function syncMaster(): void {
    enabled.value = $userdata.get<boolean>(KEYS.MODULES.OVERLAY.ENABLED, false) === true;
  }

  async function refresh(): Promise<void> {
    const current = ++generation;
    if (!slots.value.length) loading.value = true;
    try {
      const list = await readAllSlots();
      if (current !== generation) return;
      slots.value = list.map((slot) => ({
        ...slot,
        style: { ...OVERLAY_STYLE_DEFAULTS, ...(slot.style || {}) },
      }));
      failed.value = false;
    } catch {
      if (current === generation) failed.value = true;
    } finally {
      if (current === generation) {
        loading.value = false;
        syncMaster();
      }
    }
  }

  function isActive(slot: OverlaySlot): boolean {
    return enabled.value && slot.enabled;
  }

  /** O interruptor geral liga/desliga todas as sobreposições de uma vez. */
  function setEnabled(value: boolean): void {
    $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, value);
    enabled.value = value;
    $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, { enabled: value });
  }

  /**
   * Clique no card: alterna. Chave geral desligada com o slot habilitado conta
   * como desativado, então o primeiro clique liga a chave em vez de apagar a
   * configuração do slot.
   */
  async function toggle(slot: OverlaySlot): Promise<boolean> {
    if (pending.has(slot.id)) return true;
    pending.add(slot.id);
    const activate = !isActive(slot);
    try {
      // Relê antes de gravar: o módulo pode ter alterado estilo/posição desde
      // o último carregamento, e um objeto antigo apagaria essa edição.
      const fresh = (await readAllSlots()).find((item) => item.id === slot.id);
      if (!fresh) {
        await refresh();
        return false;
      }
      fresh.enabled = activate;
      await writeSlot(fresh);

      const index = slots.value.findIndex((item) => item.id === fresh.id);
      if (index !== -1) slots.value[index] = fresh;

      if (activate) {
        if (!enabled.value) {
          $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);
          enabled.value = true;
        }
      } else if (!slots.value.some((item) => item.enabled)) {
        $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, false);
        enabled.value = false;
      }

      $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, { slot: fresh });
      return true;
    } catch {
      await refresh();
      return false;
    } finally {
      pending.delete(slot.id);
    }
  }

  useBroadcastListener(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, () => {
    void refresh();
  });

  onMounted(() => void refresh());
  // O módulo de apresentação é persistente: ao voltar de outra aba, o que
  // mudou enquanto esta tela estava parada precisa aparecer. No primeiro
  // mount o KeepAlive também dispara `activated`; aí o refresh já aconteceu.
  let activatedOnce = false;
  onActivated(() => {
    if (!activatedOnce) {
      activatedOnce = true;
      return;
    }
    void refresh();
  });

  return { slots, loading, failed, enabled, isActive, setEnabled, toggle, refresh };
}
