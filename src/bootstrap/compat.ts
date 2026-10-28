// Navegadores parados em 2021–2023 (Edge 92, iOS anterior ao 17.4, Chrome anterior ao
// 116) não têm estas funções. Sem `AbortSignal.any`, todo fetch do app falha antes de
// sair e o app se julga offline, sem erro nenhum na tela.

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
}

export function installCompat(): void {
  if (typeof Object.hasOwn !== "function") {
    define(Object, "hasOwn", (object: object, key: PropertyKey) =>
      Object.prototype.hasOwnProperty.call(object, key)
    );
  }
  if (typeof AbortSignal === "undefined") return;
  if (typeof AbortSignal.timeout !== "function") {
    define(AbortSignal, "timeout", (ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("signal timed out", "TimeoutError")), ms);
      return controller.signal;
    });
  }
  if (typeof AbortSignal.any !== "function") {
    define(AbortSignal, "any", (signals: Iterable<AbortSignal>) => {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort(signal.reason);
          break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    });
  }
}

installCompat();
