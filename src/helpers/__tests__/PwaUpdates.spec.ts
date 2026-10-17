import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPwaUpdateController,
  PWA_UPDATE_INTERVAL_MS,
  type PwaUpdateState,
} from "../PwaUpdates";

const diagnostics = vi.hoisted(() => ({ event: vi.fn(), failure: vi.fn() }));
vi.mock("@/helpers/ReliabilityDiagnostics", () => ({
  reportReliabilityEvent: diagnostics.event,
  reportReliabilityFailure: diagnostics.failure,
}));

class Worker extends EventTarget {
  state: ServiceWorkerState = "activated";
  postMessage = vi.fn();
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function setup({
  controller = new Worker(),
  loaded = "A",
  active = "A",
  register: registerOverride = undefined as undefined | (() => Promise<unknown>),
  deployed = undefined as undefined | (() => Promise<string | null>),
} = {}) {
  const sw = Object.assign(new EventTarget(), { controller, register: vi.fn() });
  const reg = Object.assign(new EventTarget(), {
    waiting: null as Worker | null,
    installing: null as Worker | null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  sw.register.mockResolvedValue(reg);
  if (registerOverride) sw.register.mockImplementation(registerOverride);
  const window_ = new EventTarget();
  const document_ = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const states: PwaUpdateState[] = [];
  const reload = vi.fn();
  const online = vi.fn(() => true);
  const readActiveBuildId = vi.fn().mockResolvedValue(active);
  const instance = createPwaUpdateController({
    serviceWorker: sw as unknown as ServiceWorkerContainer,
    window: window_ as Window,
    document: document_ as Document,
    online,
    swUrl: "/sw.js",
    scope: "/",
    onState: (state) => states.push(state),
    loadedBuildId: loaded,
    readActiveBuildId,
    readDeployedBuildId: deployed,
    reload,
  });
  const latest = () => states.at(-1)!;
  const tick = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };
  return {
    sw,
    reg,
    window_,
    document_,
    states,
    reload,
    online,
    readActiveBuildId,
    instance,
    latest,
    tick,
  };
}

describe("PwaUpdates", () => {
  const cleanups: Array<() => void> = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanups.splice(0).forEach((fn) => fn());
    vi.useRealTimers();
  });
  const boot = (options?: Parameters<typeof setup>[0]) => {
    const value = setup(options);
    cleanups.push(value.instance.dispose);
    return value;
  };

  it("detecta SW já ativado de outro build mesmo com a mesma versão do app, sem recarregar", async () => {
    const h = boot({ loaded: "A", active: "B" });
    await h.tick();
    expect(h.latest()).toMatchObject({ ready: true, status: "ready" });
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.sw.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });

  it("observa ativação durante registro pendente e preserva a página em execução", async () => {
    const h = boot();
    h.sw.controller = new Worker();
    h.sw.dispatchEvent(new Event("controllerchange"));
    await h.tick();
    expect(h.latest().ready).toBe(true);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("a primeira instalação não anuncia uma atualização", async () => {
    const h = boot({ controller: null as unknown as Worker });
    await h.tick();
    h.sw.controller = new Worker();
    h.sw.dispatchEvent(new Event("controllerchange"));
    await h.tick();
    expect(h.latest().ready).toBe(false);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("installed/waiting temporário da primeira instalação não é uma nova versão", async () => {
    const h = boot({ controller: null as unknown as Worker });
    const worker = new Worker();
    worker.state = "installing";
    h.reg.installing = worker;
    await h.tick();
    h.reg.installing = null;
    h.reg.waiting = worker;
    worker.change("installed");
    await h.instance.check();
    expect(h.latest().ready).toBe(false);
    h.reg.waiting = null;
    h.sw.controller = worker;
    h.sw.dispatchEvent(new Event("controllerchange"));
    worker.change("activated");
    await h.tick();
    expect(h.latest()).toMatchObject({ ready: false, status: "current" });
  });

  it("verifica ao voltar online/foreground e em sessão longa; ignora intervalo em background", async () => {
    const h = boot();
    await h.tick();
    h.document_.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_INTERVAL_MS);
    expect(h.reg.update).not.toHaveBeenCalled();
    h.document_.visibilityState = "visible";
    h.document_.dispatchEvent(new Event("visibilitychange"));
    await h.tick();
    h.window_.dispatchEvent(new Event("online"));
    await h.tick();
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_INTERVAL_MS);
    expect(h.reg.update).toHaveBeenCalledTimes(3);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("não verifica offline e deduplica verificações concorrentes", async () => {
    const h = boot();
    await h.tick();
    h.online.mockReturnValue(false);
    await h.instance.check();
    expect(h.latest().status).toBe("offline");
    expect(h.reg.update).not.toHaveBeenCalled();
    h.online.mockReturnValue(true);
    let resolve!: () => void;
    h.reg.update.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const a = h.instance.check();
    const b = h.instance.check();
    expect(h.reg.update).toHaveBeenCalledOnce();
    resolve();
    await Promise.all([a, b]);
  });

  it("só recarrega pela ação manual após persistir, e revalida trabalho iniciado durante o flush", async () => {
    const h = boot({ active: "B" });
    await h.tick();
    const canReload = vi.fn().mockReturnValue(false);
    const beforeReload = vi.fn().mockResolvedValue(undefined);
    expect(await h.instance.apply({ canReload, beforeReload })).toBe(false);
    expect(beforeReload).not.toHaveBeenCalled();
    canReload.mockReturnValue(true);
    beforeReload.mockImplementation(async () => {
      canReload.mockReturnValue(false);
    });
    expect(await h.instance.apply({ canReload, beforeReload })).toBe(false);
    expect(h.reload).not.toHaveBeenCalled();
    canReload.mockReturnValue(true);
    beforeReload.mockResolvedValue(undefined);
    expect(await h.instance.apply({ canReload, beforeReload })).toBe(true);
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it("falha de persistência impede recarga e conserva atualização disponível", async () => {
    const h = boot({ active: "B" });
    await h.tick();
    expect(
      await h.instance.apply({
        canReload: () => true,
        beforeReload: async () => {
          throw new Error("IDB");
        },
      })
    ).toBe(false);
    expect(h.latest()).toMatchObject({ ready: true, status: "error" });
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("espera terminar a ativação mesmo após controllerchange antes de recarregar", async () => {
    const h = boot({ active: "B" });
    await h.tick();
    const worker = new Worker();
    worker.state = "installed";
    h.reg.waiting = worker;
    worker.postMessage.mockImplementation(() => {
      h.reg.waiting = null;
      worker.state = "activating";
      h.sw.controller = worker;
      h.sw.dispatchEvent(new Event("controllerchange"));
    });
    const pending = h.instance.apply({ canReload: () => true, beforeReload: async () => {} });
    await h.tick();
    expect(h.reload).not.toHaveBeenCalled();
    worker.change("activated");
    expect(await pending).toBe(true);
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it("ativação travada não recarrega nem perde o aviso de atualização", async () => {
    const h = boot({ active: "B" });
    await h.tick();
    h.sw.controller.state = "activating";
    const pending = h.instance.apply({ canReload: () => true, beforeReload: async () => {} });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBe(false);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.latest()).toMatchObject({ ready: true, status: "error" });
  });

  it("limita verificação pendurada e permite tentar de novo", async () => {
    const h = boot();
    await h.tick();
    h.reg.update.mockImplementationOnce(() => new Promise(() => {}));
    const pending = h.instance.check();
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(h.latest().status).toBe("error");
    await h.instance.check();
    expect(h.latest().status).toBe("current");
  });

  it("não informa código atual quando a identidade falha e recupera na próxima tentativa", async () => {
    const h = boot();
    await h.tick();
    h.readActiveBuildId.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await h.instance.check();
    expect(h.latest()).toMatchObject({ status: "error", ready: false });
    h.readActiveBuildId.mockResolvedValueOnce(null);
    await h.instance.check();
    expect(h.latest().status).toBe("error");
    await h.instance.check();
    expect(h.latest().status).toBe("current");
  });

  it("não informa código atual se a instalação já retornou redundante", async () => {
    const h = boot();
    await h.tick();
    const worker = new Worker();
    worker.state = "redundant";
    h.reg.update.mockImplementationOnce(async () => {
      h.reg.installing = worker;
    });
    await h.instance.check();
    expect(h.latest()).toMatchObject({ status: "error", ready: false });
  });

  it("save pendurado retorna erro e mantém a atualização sem recarregar", async () => {
    const h = boot({ active: "B" });
    await h.tick();
    const pending = h.instance.apply({
      canReload: () => true,
      beforeReload: () => new Promise(() => {}),
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBe(false);
    expect(h.latest()).toMatchObject({ status: "error", ready: true });
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("acompanha registro concluído depois do timeout e relata a recuperação", async () => {
    let finish!: (_value: unknown) => void;
    const h = boot({
      register: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.latest().status).toBe("error");
    expect(diagnostics.failure).toHaveBeenCalledWith(
      "pwa_update_failed",
      expect.objectContaining({ name: "TimeoutError" }),
      expect.objectContaining({ stage: "register" })
    );
    finish(h.reg);
    await h.tick();
    expect(h.latest().status).toBe("current");
    expect(diagnostics.event).toHaveBeenCalledWith(
      "pwa_update_recovered",
      expect.objectContaining({
        stage: "register",
        update_status: "current",
        recovery_ms: 0,
      })
    );
    const worker = new Worker();
    worker.state = "installing";
    h.reg.installing = worker;
    h.reg.dispatchEvent(new Event("updatefound"));
    h.reg.installing = null;
    h.reg.waiting = worker;
    worker.change("installed");
    expect(h.latest()).toMatchObject({ ready: true, status: "ready" });
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("repete falha de atualização sem clique com espera crescente e cancela ao recuperar", async () => {
    const h = boot();
    await h.tick();
    h.reg.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await h.instance.check();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(h.reg.update).toHaveBeenCalledTimes(1);
    h.reg.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(1);
    expect(h.reg.update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(h.reg.update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.reg.update).toHaveBeenCalledTimes(3);
    expect(h.latest().status).toBe("current");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.reg.update).toHaveBeenCalledTimes(3);
  });

  it("não repete em segundo plano e retoma ao voltar para o app", async () => {
    const h = boot();
    await h.tick();
    h.reg.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await h.instance.check();
    h.document_.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.reg.update).toHaveBeenCalledTimes(1);
    h.document_.visibilityState = "visible";
    h.document_.dispatchEvent(new Event("visibilitychange"));
    await h.tick();
    expect(h.latest().status).toBe("current");
  });

  it("descartar o controlador impede retry e diagnóstico de registro tardio", async () => {
    let finish!: (_value: unknown) => void;
    const h = boot({
      register: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await vi.advanceTimersByTimeAsync(30_000);
    h.instance.dispose();
    diagnostics.event.mockClear();
    finish(h.reg);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sw.register).toHaveBeenCalledTimes(1);
    expect(diagnostics.event).not.toHaveBeenCalled();
  });

  it("recupera registro rejeitado automaticamente, sem depender do intervalo de 15 minutos", async () => {
    const h = boot({ register: () => Promise.reject(new TypeError("Falha ao buscar sw.js")) });
    await h.tick();
    expect(h.latest().status).toBe("error");
    h.sw.register.mockResolvedValue(h.reg);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.latest().status).toBe("current");
    expect(h.sw.register).toHaveBeenCalledTimes(2);
    expect(diagnostics.event).toHaveBeenCalledWith(
      "pwa_update_recovered",
      expect.objectContaining({
        stage: "register",
        attempts: 1,
        recovery_ms: 15_000,
      })
    );
  });

  it("instalação lenta mantém o acompanhamento e informa a etapa correta", async () => {
    const h = boot();
    await h.tick();
    const worker = new Worker();
    worker.state = "installing";
    h.reg.update.mockImplementationOnce(async () => {
      h.reg.installing = worker;
      h.reg.dispatchEvent(new Event("updatefound"));
    });
    const checking = h.instance.check();
    await vi.advanceTimersByTimeAsync(30_000);
    await checking;
    expect(diagnostics.failure).toHaveBeenCalledWith(
      "pwa_update_failed",
      expect.objectContaining({
        name: "TimeoutError",
      }),
      expect.objectContaining({ stage: "install_worker" })
    );
    await vi.advanceTimersByTimeAsync(2000);
    h.reg.installing = null;
    h.reg.waiting = worker;
    worker.change("installed");
    expect(h.latest()).toMatchObject({ ready: true, status: "ready" });
    expect(diagnostics.event).toHaveBeenCalledWith(
      "pwa_update_recovered",
      expect.objectContaining({
        stage: "install_worker",
        recovery_ms: 2000,
      })
    );
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("fica offline sem tentar até a rede voltar e não perde uma atualização já pronta", async () => {
    const h = boot();
    await h.tick();
    h.reg.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await h.instance.check();
    h.online.mockReturnValue(false);
    h.window_.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.reg.update).toHaveBeenCalledTimes(1);
    expect(h.latest().status).toBe("offline");
    h.readActiveBuildId.mockResolvedValue("B");
    h.online.mockReturnValue(true);
    h.window_.dispatchEvent(new Event("online"));
    await h.tick();
    expect(h.latest()).toMatchObject({ status: "ready", ready: true });
    h.online.mockReturnValue(false);
    h.window_.dispatchEvent(new Event("offline"));
    expect(h.latest()).toMatchObject({ status: "ready", ready: true });
  });

  it("contorna CDN antiga pela versão publicada e mantém a URL estável entre verificações", async () => {
    const deployed = vi.fn().mockResolvedValue("B");
    const h = boot({ loaded: "A", deployed });
    await h.tick();
    expect(h.sw.register).toHaveBeenCalledWith(
      "/sw.js?build=B",
      expect.objectContaining({ updateViaCache: "none" })
    );
    await h.instance.check();
    expect(h.sw.register).toHaveBeenCalledTimes(1);
    deployed.mockResolvedValue("C");
    await h.instance.check();
    expect(h.sw.register).toHaveBeenLastCalledWith("/sw.js?build=C", expect.anything());
    expect(h.sw.register).toHaveBeenCalledTimes(2);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("falha ao consultar publicação não registra o HTML antigo sobre uma instalação nova", async () => {
    const deployed = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("B");
    const h = boot({ loaded: "A", deployed });
    await h.tick();
    expect(h.sw.register).not.toHaveBeenCalled();
    expect(h.latest().status).toBe("error");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.sw.register).toHaveBeenCalledWith("/sw.js?build=B", expect.anything());
  });
});
