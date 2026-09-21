import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBusy } from "../useBusy";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Trabalho que termina depois de `ms` milissegundos. */
const takes = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("useBusy", () => {
  it("fica ocupado assim que o trabalho começa, sem esperar nada", () => {
    const { busy, run } = useBusy(400);
    expect(busy.value).toBe(false);
    void run(() => takes(50, "ok"));
    expect(busy.value).toBe(true);
  });

  it("trabalho rápido segura o indicador até o mínimo, para ele não piscar", async () => {
    const { busy, run } = useBusy(400);
    const done = run(() => takes(20, "ok"));

    await vi.advanceTimersByTimeAsync(20);
    expect(busy.value).toBe(true);
    await vi.advanceTimersByTimeAsync(379);
    expect(busy.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(busy.value).toBe(false);
    await expect(done).resolves.toBe("ok");
  });

  it("trabalho mais longo que o mínimo termina sem espera extra", async () => {
    const { busy, run } = useBusy(400);
    const done = run(() => takes(1000, "ok"));

    await vi.advanceTimersByTimeAsync(999);
    expect(busy.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(busy.value).toBe(false);
    await expect(done).resolves.toBe("ok");
  });

  it("só devolve o resultado depois de o indicador sair, para o aviso não aparecer junto com ele", async () => {
    const { busy, run } = useBusy(400);
    const seenAtReturn: boolean[] = [];
    const done = run(() => takes(20, "ok")).then((value) => {
      seenAtReturn.push(busy.value);
      return value;
    });

    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(seenAtReturn).toEqual([false]);
  });

  it("erro no trabalho também segura o mínimo, solta o indicador e repassa o erro", async () => {
    const { busy, run } = useBusy(400);
    const failed = run(async () => {
      throw new Error("falhou");
    });
    const outcome = failed.then(
      () => "resolveu",
      (error: Error) => error.message
    );

    await vi.advanceTimersByTimeAsync(399);
    expect(busy.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(busy.value).toBe(false);
    await expect(outcome).resolves.toBe("falhou");
  });

  it("dois trabalhos ao mesmo tempo: o indicador só sai quando o último termina", async () => {
    const { busy, run } = useBusy(100);
    void run(() => takes(50, "a"));
    void run(() => takes(500, "b"));

    await vi.advanceTimersByTimeAsync(200);
    expect(busy.value).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(busy.value).toBe(false);
  });

  it("cada chamada a useBusy tem o seu estado", () => {
    const first = useBusy();
    const second = useBusy();
    void first.run(() => takes(50, "ok"));
    expect(first.busy.value).toBe(true);
    expect(second.busy.value).toBe(false);
  });
});
