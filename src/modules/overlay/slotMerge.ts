import type { OverlaySlot } from "@/types/Overlay";

/**
 * Mescla o `enabled` que está no disco com a edição pendente do módulo.
 *
 * O Modo apresentação (e a liturgia) liga/desliga slots gravando direto no
 * IndexedDB. O módulo Overlay tem um save com debounce de 200 ms que grava
 * todos os slots; sem esta mescla, esse save atrasado devolveria o interruptor
 * antigo e apagaria a escolha feita na aba. Só o interruptor do próprio módulo
 * (`enabledChanged`) manda no campo; o resto continua vindo da tela.
 */
export function mergeEnabledState(
  local: OverlaySlot[],
  stored: OverlaySlot[],
  enabledChanged: ReadonlySet<string>
): OverlaySlot[] {
  const persisted = new Map(stored.map((slot) => [slot.id, slot]));
  return local.map((slot) => {
    if (enabledChanged.has(slot.id)) return slot;
    const saved = persisted.get(slot.id);
    return saved ? { ...slot, enabled: saved.enabled === true } : slot;
  });
}
