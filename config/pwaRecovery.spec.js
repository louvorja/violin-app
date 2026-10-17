import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPwaRecovery } from "./pwaRecovery.cjs";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
let sw;
let reload;
let active;
const boot = (build = A) => {
  installPwaRecovery({ scope: "/", build, storageKey: "test-recovery", startupWaitMs: 2500 });
  return window.__ljPwaRecovery;
};
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  document.body.innerHTML = "";
  delete window.__ljPwaRecovery;
  active = A;
  reload = vi.fn();
  vi.stubGlobal("location", { origin: "https://app.test", reload });
  sw = Object.assign(new EventTarget(), {
    controller: {},
    register: vi.fn().mockResolvedValue(
      Object.assign(new EventTarget(), {
        waiting: null,
        update: vi.fn().mockResolvedValue(undefined),
      })
    ),
  });
  vi.stubGlobal("navigator", { serviceWorker: sw });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ version: 1, id: active })))
  );
});
afterEach(() => {
  window.__ljPwaRecovery?.markMounted();
  delete window.__ljPwaRecovery;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recuperação independente do aplicativo", () => {
  it("consulta publicação fora do precache e registra URL nova sem depender do cache da CDN", async () => {
    fetch.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({
            version: 1,
            id: url.searchParams.has("network") ? B : A,
          })
        )
    );
    expect(await boot().ready).toBe(false);
    expect(sw.register).toHaveBeenCalledWith(new URL(`https://app.test/sw.js?build=${B}`), {
      scope: "/",
      updateViaCache: "none",
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("se a publicação estiver indisponível, preserva o registro existente", async () => {
    const existing = Object.assign(new EventTarget(), {
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    });
    sw.getRegistration = vi.fn().mockResolvedValue(existing);
    fetch.mockImplementation(async (url) => {
      if (url.searchParams.has("network")) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ version: 1, id: A }));
    });
    expect(await boot().ready).toBe(false);
    expect(sw.register).not.toHaveBeenCalled();
    expect(existing.update).toHaveBeenCalledOnce();
  });

  it("identidade ativa corrompida não impede buscar o código publicado", async () => {
    fetch.mockImplementation(
      async (url) =>
        new Response(
          url.searchParams.has("network") ? JSON.stringify({ version: 1, id: B }) : "corrompido"
        )
    );
    expect(await boot().ready).toBe(false);
    expect(sw.register).toHaveBeenCalledWith(
      new URL(`https://app.test/sw.js?build=${B}`),
      expect.anything()
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("aplica código pronto antes de iniciar, sem importar módulos do app", async () => {
    active = B;
    const recovery = boot();
    expect(await recovery.ready).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("primeira instalação não recarrega nem apaga o armazenamento", async () => {
    const recovery = boot();
    expect(await recovery.ready).toBe(false);
    sw.dispatchEvent(new Event("controllerchange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it("um bootstrap quebrado continua buscando código corrigido e recupera na ativação", async () => {
    const recovery = boot();
    await recovery.ready;
    window.dispatchEvent(
      new CustomEvent("lj:bootstrap-failed", { detail: new Error("chunk antigo ausente") })
    );
    expect(document.body.textContent).toContain("Verificar e recuperar");
    active = B;
    sw.dispatchEvent(new Event("controllerchange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledOnce();
    expect(JSON.parse(sessionStorage.getItem("test-recovery")).events[0]).toMatchObject({
      stage: "bootstrap",
      error_message: "chunk antigo ausente",
    });
  });

  it("relê a identidade ao terminar activate, depois de controllerchange", async () => {
    await boot().ready;
    const worker = Object.assign(new EventTarget(), { state: "activating" });
    sw.controller = worker;
    sw.dispatchEvent(new Event("controllerchange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    active = B;
    worker.state = "activated";
    worker.dispatchEvent(new Event("statechange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("ativa código que termina de instalar depois da verificação em um bootstrap quebrado", async () => {
    const worker = Object.assign(new EventTarget(), { state: "installing", postMessage: vi.fn() });
    const value = Object.assign(new EventTarget(), {
      installing: worker,
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    });
    sw.register.mockResolvedValue(value);
    await boot().ready;
    value.installing = null;
    value.waiting = worker;
    worker.state = "installed";
    worker.dispatchEvent(new Event("statechange"));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("acompanha um registro nativo que termina após o timeout do bootstrap", async () => {
    let finish;
    sw.register.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    boot();
    await vi.advanceTimersByTimeAsync(10_001);
    const worker = Object.assign(new EventTarget(), { state: "installed", postMessage: vi.fn() });
    finish(Object.assign(new EventTarget(), { waiting: worker, update: vi.fn() }));
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("não entra em laço se a recarga receber novamente o HTML antigo", async () => {
    sessionStorage.setItem("test-recovery", JSON.stringify({ target: B, at: Date.now() }));
    active = B;
    expect(await boot().ready).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("sai do caminho quando a interface monta e não recarrega uma apresentação", async () => {
    const recovery = boot();
    await recovery.ready;
    recovery.markMounted();
    active = B;
    sw.dispatchEvent(new Event("controllerchange"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).not.toHaveBeenCalled();
    expect(sw.register).toHaveBeenCalledTimes(1);
  });

  it("registro pendurado não bloqueia boot nem impede nova tentativa", async () => {
    sw.register.mockImplementationOnce(() => new Promise(() => {}));
    const recovery = boot();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await recovery.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(7500);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).toHaveBeenCalledTimes(2);
    expect(recovery.drainDiagnostics()).toEqual([expect.objectContaining({ stage: "recover" })]);
  });

  it("uma resposta inválida não provoca recarga", async () => {
    fetch.mockResolvedValue(new Response("<html>portal</html>"));
    expect(await boot().ready).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("falha de registro offline ainda aplica código que já foi guardado", async () => {
    sw.register.mockRejectedValue(new TypeError("Failed to fetch"));
    active = B;
    expect(await boot().ready).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
