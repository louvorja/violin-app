/** @category helper-puro — Ciclo de atualização da PWA, sem Pinia ou APIs Vue. */
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { reportReliabilityEvent, reportReliabilityFailure } from "@/helpers/ReliabilityDiagnostics";
export const PWA_UPDATE_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 30_000;
const RETRY_INITIAL_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;

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
  readDeployedBuildId?: () => Promise<string | null>;
  initialController?: ServiceWorker | null;
}

export function createPwaUpdateController(options: UpdateOptions) {
  const { serviceWorker, window: window_, document: document_, online, onState } = options;
  let state: PwaUpdateState = { status: "idle", ready: false, lastCheckedAt: null };
  let registration: ServiceWorkerRegistration | null = null;
  let observedController =
    options.initialController === undefined ? serviceWorker.controller : options.initialController;
  let activeBuildId: string | null = null;
  let registeredBuildId: string | null = null;
  let registerAttempt = 0;
  let acceptedRegisterAttempt = 0;
  let checking: Promise<void> | null = null;
  let applying: Promise<boolean> | null = null;
  let disposed = false;
  let activation: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = RETRY_INITIAL_MS;
  const failures = new Map<string, { started: number; attempts: number }>();
  const observedRegistrations = new WeakSet<ServiceWorkerRegistration>();
  const observedWorkers = new WeakSet<ServiceWorker>();
  const cleanups: Array<() => void> = [];

  const publish = (patch: Partial<PwaUpdateState>) => {
    if (disposed) return;
    const previous = state.status;
    state = { ...state, ...patch };
    if (patch.status === "current" || patch.status === "ready") {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      retryDelay = RETRY_INITIAL_MS;
      for (const [stage, failure] of failures) {
        reportReliabilityEvent("pwa_update_recovered", {
          stage,
          attempts: failure.attempts,
          recovery_ms: Date.now() - failure.started,
          update_status: state.status,
          loaded_build: options.loadedBuildId ?? null,
          active_build: activeBuildId,
        });
      }
      failures.clear();
    }
    if (previous !== state.status)
      reportReliabilityEvent("pwa_update_state", {
        status: state.status,
        // Campo novo evita a inferência histórica de `status` como número no PostHog.
        update_status: state.status,
        ready: state.ready,
        loaded_build: options.loadedBuildId ?? null,
        active_build: activeBuildId,
      });
    if (!disposed) onState({ ...state });
  };
  const failed = (stage: string, error: unknown) => {
    if (disposed) return;
    // Sem rede a falha é a esperada: o estado diz "offline" e o evento `online`
    // verifica de novo. Relatar como erro contava toda sessão sem internet.
    if (!online()) {
      if (!state.ready) publish({ status: "offline" });
      return;
    }
    const previous = failures.get(stage);
    const failure = {
      started: previous?.started ?? Date.now(),
      attempts: (previous?.attempts ?? 0) + 1,
    };
    failures.set(stage, failure);
    reportReliabilityFailure("pwa_update_failed", error, {
      stage,
      attempt: failure.attempts,
      update_status: state.status,
      loaded_build: options.loadedBuildId ?? null,
      active_build: activeBuildId,
    });
    if (!state.ready) publish({ status: online() ? "error" : "offline" });
    if (retryTimer === undefined && !state.ready) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!disposed && online() && document_.visibilityState === "visible") void check();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    }
  };
  const ready = () => publish({ ready: true, status: applying ? "applying" : "ready" });
  const slow = (stage: string, durationMs: number) =>
    reportReliabilityEvent("pwa_update_slow", {
      stage,
      duration_ms: durationMs,
      loaded_build: options.loadedBuildId ?? null,
      active_build: activeBuildId,
    });
  // Leitura passa pelo precache do controlador ativo. Assim um documento A
  // detecta SW B mesmo se a ativação ocorreu antes de carregar este módulo.
  const inspectBuild = async () => {
    if (!serviceWorker.controller || !options.loadedBuildId || !options.readActiveBuildId)
      return true;
    try {
      const activeId = await bounded(options.readActiveBuildId());
      if (!activeId) throw new Error("Não foi possível identificar o código ativo");
      activeBuildId = activeId;
      if (activeId !== options.loadedBuildId && !disposed) ready();
      return true;
    } catch (error) {
      failed("read_build", error);
      return false;
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
          timeout = setTimeout(
            () => reject(new DOMException("PWA update timeout", "TimeoutError")),
            UPDATE_TIMEOUT_MS
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  const observeWorker = (worker: ServiceWorker | null) => {
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    const changed = () => {
      if (worker.state === "installed") {
        if (registration?.waiting === worker && observedController) ready();
        else if (!state.ready) publish({ status: "checking" });
      } else if (worker.state === "activated") {
        void inspectBuild().then((verified) => {
          if (verified && !state.ready) publish({ status: "current" });
        });
      } else if (worker.state === "redundant" && !state.ready) {
        failed("install_worker", new Error("A instalação do novo código não foi concluída"));
      }
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

  const register = (buildId?: string | null) => {
    const attempt = ++registerAttempt;
    const startedAt = Date.now();
    const url = buildId ? `${options.swUrl}?build=${encodeURIComponent(buildId)}` : options.swUrl;
    // O timeout limita a espera da UI, não cancela register() no navegador.
    // Observe o resultado nativo mesmo se chegar tarde, sem perder updatefound.
    const operation = Promise.resolve()
      .then(() =>
        serviceWorker.register(url, {
          scope: options.scope,
          updateViaCache: "none",
        })
      )
      .then((value) => {
        if (disposed) return value;
        if (attempt < acceptedRegisterAttempt) return registration;
        acceptedRegisterAttempt = attempt;
        registration = value;
        registeredBuildId = buildId ?? null;
        if (!observedRegistrations.has(value)) {
          observedRegistrations.add(value);
          listen(value, "updatefound", () => observeWorker(value.installing));
        }
        observeWorker(value.installing);
        if (value.waiting && serviceWorker.controller) ready();
        if (
          serviceWorker.controller &&
          observedController &&
          serviceWorker.controller !== observedController
        )
          ready();
        observedController = serviceWorker.controller;
        void inspectBuild().then((verified) => {
          if (verified && !value.installing && !state.ready)
            publish({ status: online() ? "current" : "offline" });
        });
        return value;
      });
    // Sem prazo: na primeira visita o register() só resolve depois que o navegador
    // baixa o app inteiro para o cache (5,7 MB em 513 arquivos, ~70 s no Wi-Fi).
    // Com 30 s, quase toda primeira visita via a faixa de erro e virava exceção.
    // A demora fica medida; só a rejeição do navegador é falha.
    return operation
      .then((value) => {
        const duration = Date.now() - startedAt;
        if (duration >= UPDATE_TIMEOUT_MS && !disposed) slow("register", duration);
        return value;
      })
      .catch((error) => {
        // Outra tentativa/registro tardio já pode ter restabelecido o monitor.
        if (attempt < acceptedRegisterAttempt) return registration;
        failed("register", error);
        return null;
      });
  };
  const readDeployed = async () => {
    try {
      const deployed = await bounded(options.readDeployedBuildId!());
      if (!deployed) throw new Error("Não foi possível identificar o código publicado");
      return deployed;
    } catch (error) {
      failed("read_deployed_build", error);
      return null;
    }
  };
  // O HTML pode ser anterior ao SW que o bootstrap já começou a instalar.
  // Não registre sua versão antiga por cima da publicação mais recente.
  let registered = options.readDeployedBuildId
    ? readDeployed().then((deployed) => (deployed && !disposed ? register(deployed) : null))
    : register();
  if (options.readDeployedBuildId) void inspectBuild();

  async function check(): Promise<void> {
    if (disposed || checking) return checking ?? undefined;
    if (!online()) {
      if (!state.ready) publish({ status: "offline" });
      return;
    }
    checking = (async () => {
      let value = registration ?? (await registered);
      if (options.readDeployedBuildId) {
        const deployed = await readDeployed();
        if (!deployed || disposed) return;
        // updateViaCache ignora o cache HTTP local, mas não o cache da CDN.
        // A identidade publicada escolhe uma URL estável e nova por deploy.
        if (!value || deployed !== registeredBuildId) {
          registered = register(deployed);
          value = await registered;
          if (!value) return;
        }
      }
      if (!value && !disposed) {
        registered = register();
        value = await registered;
      }
      if (!value || disposed) return;
      if (!state.ready) publish({ status: "checking" });
      let stage = "check";
      try {
        await bounded(value.update());
        const installing = value.installing;
        stage = "install_worker";
        if (
          installing &&
          installing.state !== "installed" &&
          installing.state !== "activated" &&
          installing.state !== "redundant"
        ) {
          let stop = () => {};
          try {
            await bounded(
              new Promise<void>((resolve) => {
                const changed = () => {
                  if (
                    ["activated", "redundant"].includes(installing.state) ||
                    (installing.state === "installed" && value.waiting === installing)
                  )
                    resolve();
                };
                installing.addEventListener("statechange", changed);
                stop = () => installing.removeEventListener("statechange", changed);
                changed();
              })
            );
          } finally {
            stop();
          }
        }
        if (installing?.state === "redundant")
          throw new Error("Instalação da atualização interrompida");
        const verified = await inspectBuild();
        if (value.waiting && serviceWorker.controller) ready();
        else if (verified && !value.installing && !state.ready) publish({ status: "current" });
        publish({ lastCheckedAt: Date.now() });
      } catch (error) {
        // Baixar o código novo pode passar do prazo sem nada errado. Com um worker
        // instalando, o acompanhamento dele (updatefound/statechange) publica o
        // resultado: pronto, ou falha se ele terminar redundante.
        if (error instanceof DOMException && error.name === "TimeoutError" && value.installing) {
          if (!state.ready) publish({ status: "checking" });
          slow(stage, UPDATE_TIMEOUT_MS);
          return;
        }
        failed(stage, error);
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
        // controllerchange pode ocorrer durante activate/clients.claim().
        // Uma navegação nessa janela pode ficar aguardando a ativação do SW.
        const active = serviceWorker.controller;
        if (!active) throw new Error("Controlador da atualização indisponível");
        let stop = () => {};
        try {
          await bounded(
            new Promise<void>((resolve, reject) => {
              const changed = () => {
                if (active.state === "activated") resolve();
                else if (active.state === "redundant")
                  reject(new Error("Ativação da atualização interrompida"));
              };
              active.addEventListener("statechange", changed);
              stop = () => active.removeEventListener("statechange", changed);
              changed();
            })
          );
        } finally {
          stop();
        }
        if (!canReload() || disposed) return false;
        options.reload(); // A janela já verificou atividade e persistiu as alterações.
        return true;
      } catch (error) {
        reportReliabilityFailure("pwa_update_failed", error, {
          stage: "apply",
          loaded_build: options.loadedBuildId,
          active_build: activeBuildId,
        });
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
      clearTimeout(retryTimer);
      cleanups.forEach((cleanup) => cleanup());
      activation?.();
      activation = null;
    },
  };
}

let snapshot: PwaUpdateState = { status: "idle", ready: false, lastCheckedAt: null };
const subscribers = new Set<(_state: PwaUpdateState) => void>();
let controller: ReturnType<typeof createPwaUpdateController> | null = null;

export function startPwaUpdates(initialController?: ServiceWorker | null) {
  if (controller) return controller;
  if (!navigator.serviceWorker) {
    snapshot = { ...snapshot, status: "unsupported" };
    subscribers.forEach((subscriber) => subscriber(snapshot));
    return;
  }
  const scope = import.meta.env.BASE_URL || "/";
  const readBuildId = async (deployed = false) => {
    const url = new URL(`${scope}app-build.json`, window.location.origin);
    // Este parâmetro não é ignorado pelo precache: consulta a publicação na rede.
    if (deployed) url.searchParams.set("network", "1");
    const response = await fetchWithTimeout(url, {
      cache: "no-store",
      timeout: NET_TIMEOUT.QUICK,
      signal: AbortSignal.timeout(NET_TIMEOUT.QUICK),
      source: deployed ? "pwa-deployed-build" : "pwa-build",
    });
    if (!response.ok) return null;
    const body = await response.text();
    if (body.length > 256) return null;
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object") return null;
    const build = value as { version?: unknown; id?: unknown };
    return build.version === 1 && typeof build.id === "string" && /^[a-f0-9-]{36}$/.test(build.id)
      ? build.id
      : null;
  };
  controller = createPwaUpdateController({
    serviceWorker: navigator.serviceWorker,
    window,
    document,
    online: () => navigator.onLine !== false,
    swUrl: new URL(`${scope}sw.js`, window.location.origin).href,
    scope,
    initialController,
    loadedBuildId: document.querySelector<HTMLMetaElement>('meta[name="louvorja-build"]')?.content,
    readActiveBuildId: () => readBuildId(),
    readDeployedBuildId: () => readBuildId(true),
    onState: (state) => {
      snapshot = state;
      subscribers.forEach((subscriber) => subscriber(state));
    },
    reload: () => window.location.reload(),
  });
  return controller;
}

export function subscribePwaUpdates(subscriber: (_state: PwaUpdateState) => void): () => void {
  subscribers.add(subscriber);
  subscriber(snapshot);
  return () => subscribers.delete(subscriber);
}

export const checkPwaUpdate = () => controller?.check();
export const applyPwaUpdate = (options: ApplyOptions) =>
  controller?.apply(options) ?? Promise.resolve(false);
