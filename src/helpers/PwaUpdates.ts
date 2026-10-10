/** @category helper-puro — Ciclo de atualização da PWA, sem Pinia ou APIs Vue. */
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
export const PWA_UPDATE_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 30_000;

export interface PwaUpdateState {
  status:
    | "idle"
    | "checking"
    | "current"
    | "offline"
    | "ready"
    | "applying"
    | "error"
    | "unsupported";
  ready: boolean;
  lastCheckedAt: number | null;
}

interface ApplyOptions {
  canReload: () => boolean;
  beforeReload: () => Promise<void>;
}

interface UpdateOptions {
  serviceWorker: ServiceWorkerContainer;
  window: Window;
  document: Document;
  online: () => boolean;
  swUrl: string;
  scope: string;
  onState: (_state: PwaUpdateState) => void;
  reload: () => void;
  loadedBuildId?: string | null;
  readActiveBuildId?: () => Promise<string | null>;
  initialController?: ServiceWorker | null;
}

export function createPwaUpdateController(options: UpdateOptions) {
  const { serviceWorker, window: window_, document: document_, online, onState } = options;
  let state: PwaUpdateState = { status: "idle", ready: false, lastCheckedAt: null };
  let registration: ServiceWorkerRegistration | null = null;
  let observedController = options.initialController ?? serviceWorker.controller;
  let checking: Promise<void> | null = null;
  let applying: Promise<boolean> | null = null;
  let disposed = false;
  let activation: (() => void) | null = null;
  const cleanups: Array<() => void> = [];

  const publish = (patch: Partial<PwaUpdateState>) => {
    state = { ...state, ...patch };
    if (!disposed) onState({ ...state });
  };
  const ready = () => publish({ ready: true, status: applying ? "applying" : "ready" });
  // Leitura passa pelo precache do controlador ativo. Assim um documento A
  // detecta SW B mesmo se a ativação ocorreu antes de carregar este módulo.
  const inspectBuild = async () => {
    if (!options.loadedBuildId || !options.readActiveBuildId) return;
    try {
      const activeId = await bounded(options.readActiveBuildId());
      if (activeId && activeId !== options.loadedBuildId && !disposed) ready();
    } catch {
      // A verificação nativa do SW continua válida sem esse arquivo auxiliar.
    }
  };
  const listen = (target: EventTarget, event: string, handler: () => void) => {
    target.addEventListener(event, handler);
    cleanups.push(() => target.removeEventListener(event, handler));
  };
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("PWA update timeout")), UPDATE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  const observeWorker = (worker: ServiceWorker | null) => {
    if (!worker) return;
    const changed = () => {
      if (worker.state === "installed") {
        if (registration?.waiting === worker && observedController) ready();
        else if (!state.ready) publish({ status: "checking" });
      } else if (worker.state === "activated") {
        void inspectBuild();
        if (!state.ready) publish({ status: "current" });
      } else if (worker.state === "redundant" && !state.ready) publish({ status: "error" });
    };
    listen(worker, "statechange", changed);
    changed();
  };

  // Escuta antes de register()/bootstrap/IndexedDB. Também cobre a ativação
  // feita por outra aba ou por um SW legado com skipWaiting automático.
  listen(serviceWorker, "controllerchange", () => {
    const current = serviceWorker.controller;
    if (current && current !== observedController) {
      if (observedController) ready();
      observedController = current;
      activation?.();
      void inspectBuild();
    }
  });

  const register = () =>
    bounded(
      serviceWorker.register(options.swUrl, {
        scope: options.scope,
        updateViaCache: "none",
      })
    )
      .then((value) => {
        registration = value;
        if (disposed) return value;
        listen(value, "updatefound", () => observeWorker(value.installing));
        observeWorker(value.installing);
        if (value.waiting && serviceWorker.controller) ready();
        else if (!value.installing && !state.ready)
          publish({ status: online() ? "current" : "offline" });
        if (
          serviceWorker.controller &&
          observedController &&
          serviceWorker.controller !== observedController
        )
          ready();
        observedController = serviceWorker.controller;
        void inspectBuild();
        return value;
      })
      .catch(() => {
        publish({ status: online() ? "error" : "offline" });
        return null;
      });
  let registered = register();

  async function check(): Promise<void> {
    if (disposed || checking) return checking ?? undefined;
    if (!online()) {
      if (!state.ready) publish({ status: "offline" });
      return;
    }
    checking = (async () => {
      let value = registration ?? (await registered);
      if (!value && !disposed) {
        registered = register();
        value = await registered;
      }
      if (!value || disposed) return;
      if (!state.ready) publish({ status: "checking" });
      try {
        await bounded(value.update());
        await inspectBuild();
        if (value.waiting && serviceWorker.controller) ready();
        else if (!value.installing && !state.ready) publish({ status: "current" });
        publish({ lastCheckedAt: Date.now() });
      } catch {
        if (!state.ready) publish({ status: "error" });
      }
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  function apply({ canReload, beforeReload }: ApplyOptions): Promise<boolean> {
    if (applying) return applying;
    if (!state.ready || !canReload() || disposed) return Promise.resolve(false);
    applying = (async () => {
      publish({ status: "applying" });
      try {
        await bounded(beforeReload());
        if (!canReload() || disposed) return false;
        const waiting = registration?.waiting;
        if (waiting) {
          await bounded(
            new Promise<void>((resolve) => {
              activation = resolve;
              waiting.postMessage({ type: "SKIP_WAITING" });
            })
          );
        }
        if (!canReload() || disposed) return false;
        options.reload(); // único reload: ação explícita desta janela
        return true;
      } catch {
        publish({ status: "error" });
        return false;
      } finally {
        activation = null;
        applying = null;
        if (state.status === "applying") publish({ status: "ready" });
      }
    })();
    return applying;
  }

  const foreground = () => {
    if (document_.visibilityState === "visible") void check();
  };
  listen(document_, "visibilitychange", foreground);
  listen(window_, "pageshow", foreground);
  listen(window_, "online", () => {
    void check();
  });
  listen(window_, "offline", () => {
    if (!state.ready) publish({ status: "offline" });
  });
  const interval = setInterval(foreground, PWA_UPDATE_INTERVAL_MS);
  return {
    check,
    apply,
    dispose() {
      disposed = true;
      clearInterval(interval);
      cleanups.forEach((cleanup) => cleanup());
      activation?.();
      activation = null;
    },
  };
}

let snapshot: PwaUpdateState = { status: "idle", ready: false, lastCheckedAt: null };
const subscribers = new Set<(_state: PwaUpdateState) => void>();
let controller: ReturnType<typeof createPwaUpdateController> | null = null;

export function startPwaUpdates(initialController?: ServiceWorker | null): void {
  if (controller) return;
  if (!navigator.serviceWorker) {
    snapshot = { ...snapshot, status: "unsupported" };
    subscribers.forEach((subscriber) => subscriber(snapshot));
    return;
  }
  const scope = import.meta.env.BASE_URL || "/";
  controller = createPwaUpdateController({
    serviceWorker: navigator.serviceWorker,
    window,
    document,
    online: () => navigator.onLine !== false,
    swUrl: new URL(`${scope}sw.js`, window.location.origin).href,
    scope,
    initialController,
    loadedBuildId: document.querySelector<HTMLMetaElement>('meta[name="louvorja-build"]')?.content,
    readActiveBuildId: async () => {
      const response = await fetchWithTimeout(
        new URL(`${scope}app-build.json`, window.location.origin),
        {
          cache: "no-store",
          timeout: NET_TIMEOUT.QUICK,
          signal: AbortSignal.timeout(NET_TIMEOUT.QUICK),
          source: "pwa-build",
        }
      );
      if (!response.ok) return null;
      const body = await response.text();
      if (body.length > 256) return null;
      const value: unknown = JSON.parse(body);
      if (!value || typeof value !== "object") return null;
      const build = value as { version?: unknown; id?: unknown };
      return build.version === 1 && typeof build.id === "string" && /^[a-f0-9-]{36}$/.test(build.id)
        ? build.id
        : null;
    },
    onState: (state) => {
      snapshot = state;
      subscribers.forEach((subscriber) => subscriber(state));
    },
    reload: () => window.location.reload(),
  });
}

export function subscribePwaUpdates(subscriber: (_state: PwaUpdateState) => void): () => void {
  subscribers.add(subscriber);
  subscriber(snapshot);
  return () => subscribers.delete(subscriber);
}

export const checkPwaUpdate = () => controller?.check();
export const applyPwaUpdate = (options: ApplyOptions) =>
  controller?.apply(options) ?? Promise.resolve(false);
