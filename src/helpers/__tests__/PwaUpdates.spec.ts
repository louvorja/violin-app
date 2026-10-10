import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPwaUpdateController,
  PWA_UPDATE_INTERVAL_MS,
  type PwaUpdateState,
} from "../PwaUpdates";

class Worker extends EventTarget {
  state: ServiceWorkerState = "activated";
  postMessage = vi.fn();
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function setup({ controller = new Worker(), loaded = "A", active = "A" } = {}) {
  const sw = Object.assign(new EventTarget(), { controller, register: vi.fn() });
  const reg = Object.assign(new EventTarget(), {
    waiting: null as Worker | null,
    installing: null as Worker | null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  sw.register.mockResolvedValue(reg);
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
});
