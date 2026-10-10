/**
 * Impede a tela de apagar no navegador/PWA enquanto há algo em cena.
 *
 * É o equivalente web do `powerSaveBlocker` do Electron: um slide fica no ar o
 * hino inteiro sem toque algum, e o descanso de tela do tablet o apagaria no
 * meio do culto. Vários motivos podem pedir o bloqueio ao mesmo tempo; ele só
 * cai quando o último é solto.
 *
 * O navegador revoga a trava sozinho quando a aba perde a visibilidade, então
 * ela é pedida de novo ao voltar.
 */

type Sentinel = { release: () => Promise<void>; addEventListener: (t: "release", cb: () => void) => void };
type WakeLockApi = { request: (type: "screen") => Promise<Sentinel> };

const reasons = new Set<string>();
let sentinel: Sentinel | null = null;
let pending = false;
let dirty = false;
let listening = false;

function api(): WakeLockApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock ?? null;
}

export function isSupported(): boolean {
  return api() !== null;
}

async function sync(): Promise<void> {
  const wl = api();
  if (!wl) return;
  if (pending) {
    dirty = true;
    return;
  }

  const wanted = reasons.size > 0 && document.visibilityState === "visible";
  if (!wanted) {
    const current = sentinel;
    sentinel = null;
    await current?.release().catch(() => {});
    return;
  }
  if (sentinel) return;

  pending = true;
  dirty = false;
  try {
    const next = await wl.request("screen");
    next.addEventListener("release", () => {
      if (sentinel === next) sentinel = null;
    });
    sentinel = next;
  } catch {
    // Bateria fraca, economia de energia ou política da página: sem trava a
    // projeção segue normalmente.
  } finally {
    pending = false;
  }
  // Um motivo entrou ou saiu durante o `await`.
  if (dirty) void sync();
}

function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => void sync());
}

export function hold(reason: string): void {
  if (!isSupported()) return;
  listen();
  reasons.add(reason);
  void sync();
}

export function release(reason: string): void {
  if (!reasons.delete(reason)) return;
  void sync();
}

export default { isSupported, hold, release };
