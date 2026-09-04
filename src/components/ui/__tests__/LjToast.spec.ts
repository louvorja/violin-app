import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import LjToast from "../LjToast.vue";
import { expectKeyExists, mountUi } from "./mountUi";

// O toast é teleportado para o <body>: cada teste limpa o que deixou para trás.
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const abrir = (props: Record<string, unknown> = {}, locale: "pt" | "es" = "pt") =>
  mountUi(LjToast, { props: { modelValue: true, text: "Coletânea baixada", ...props } }, locale);

describe("LjToast", () => {
  it("não renderiza nada enquanto fechado", () => {
    mountUi(LjToast, { props: { modelValue: false, text: "oi" } });
    expect(document.querySelector(".lj-toast")).toBeNull();
  });

  it("mostra o texto quando aberto", () => {
    abrir();
    expect(document.querySelector(".lj-toast__text")?.textContent).toBe("Coletânea baixada");
  });

  it("erro é anunciado como alerta assertivo; o resto, como status educado", () => {
    abrir({ variant: "error" });
    const erro = document.querySelector(".lj-toast");
    expect(erro?.getAttribute("role")).toBe("alert");
    expect(erro?.getAttribute("aria-live")).toBe("assertive");

    document.body.innerHTML = "";
    abrir({ variant: "success" });
    const ok = document.querySelector(".lj-toast");
    expect(ok?.getAttribute("role")).toBe("status");
    expect(ok?.getAttribute("aria-live")).toBe("polite");
  });

  it("aplica a classe da variante", () => {
    for (const variant of ["info", "success", "warning", "error"] as const) {
      document.body.innerHTML = "";
      abrir({ variant });
      expect(document.querySelector(".lj-toast")?.classList).toContain(`lj-toast--${variant}`);
    }
  });

  it("fecha sozinho ao fim do tempo", async () => {
    vi.useFakeTimers();
    const w = abrir({ timeout: 3000 });
    vi.advanceTimersByTime(2999);
    expect(w.emitted("update:modelValue")).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("timeout 0 mantém o aviso até alguém fechar", () => {
    vi.useFakeTimers();
    const w = abrir({ timeout: 0 });
    vi.advanceTimersByTime(60_000);
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("segura a contagem enquanto o ponteiro está em cima", async () => {
    vi.useFakeTimers();
    const w = abrir({ timeout: 3000 });
    const el = document.querySelector(".lj-toast") as HTMLElement;

    el.dispatchEvent(new Event("mouseenter"));
    await nextTick();
    vi.advanceTimersByTime(10_000);
    expect(w.emitted("update:modelValue")).toBeUndefined();

    el.dispatchEvent(new Event("mouseleave"));
    await nextTick();
    vi.advanceTimersByTime(3000);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("botão de fechar emite o fechamento e é nomeado nos dois idiomas", async () => {
    expectKeyExists("actions.close");

    const pt = abrir();
    expect(document.querySelector(".lj-toast__close")?.getAttribute("aria-label")).toBe("Fechar");
    (document.querySelector(".lj-toast__close") as HTMLElement).click();
    await nextTick();
    expect(pt.emitted("update:modelValue")?.[0]).toEqual([false]);

    document.body.innerHTML = "";
    abrir({}, "es");
    expect(document.querySelector(".lj-toast__close")?.getAttribute("aria-label")).toBe("Cerrar");
  });

  it("dismissible false esconde o botão de fechar", () => {
    abrir({ dismissible: false });
    expect(document.querySelector(".lj-toast__close")).toBeNull();
  });

  it("só emite click quando o aviso é clicável", async () => {
    const inerte = abrir();
    (document.querySelector(".lj-toast") as HTMLElement).click();
    expect(inerte.emitted("click")).toBeUndefined();

    document.body.innerHTML = "";
    const alvo = abrir({ clickable: true });
    (document.querySelector(".lj-toast") as HTMLElement).click();
    expect(alvo.emitted("click")).toHaveLength(1);
  });

  it("não deixa temporizador vivo depois de desmontado", () => {
    vi.useFakeTimers();
    const w = abrir({ timeout: 3000 });
    w.unmount();
    vi.advanceTimersByTime(10_000);
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });
});
