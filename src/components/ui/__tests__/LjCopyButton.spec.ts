import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import LjCopyButton from "../LjCopyButton.vue";
import { mountUi } from "./mountUi";

/** jsdom não tem `navigator.clipboard`: instala (ou remove) para cada caso. */
function setClipboard(writeText?: (_value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

const COPIADO = "Copiado";

beforeEach(() => setClipboard(async () => {}));
afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe("LjCopyButton", () => {
  it("mostra o conteúdo e troca por 'Copiado' ao copiar", async () => {
    const escreveu: string[] = [];
    setClipboard(async (v) => {
      escreveu.push(v);
    });

    const w = mountUi(LjCopyButton, {
      props: { value: "http://127.0.0.1:5530/auth/canva" },
      slots: { default: "Copiar" },
    });
    expect(w.text()).toContain("Copiar");

    await w.trigger("click");
    await flushPromises();

    expect(escreveu).toEqual(["http://127.0.0.1:5530/auth/canva"]);
    expect(w.text()).toContain(COPIADO);
  });

  it("sem Clipboard API não copia e NÃO mostra 'Copiado'", async () => {
    setClipboard(undefined);

    const w = mountUi(LjCopyButton, { props: { value: "x" }, slots: { default: "Copiar" } });

    /*
     * O risco original: a chamada direta em `navigator.clipboard.writeText`
     * de um `undefined` estourava TypeError dentro do handler do clique.
     * Aqui não estoura — e, se estourasse, o vitest derrubaria o teste.
     */
    await w.trigger("click");
    await flushPromises();

    expect(w.text()).toContain("Copiar");
    expect(w.text()).not.toContain(COPIADO);
  });

  it("quando a cópia falha, não mente sobre o resultado", async () => {
    setClipboard(() => Promise.reject(new Error("permissão negada")));

    const w = mountUi(LjCopyButton, { props: { value: "x" }, slots: { default: "Copiar" } });
    await w.trigger("click");
    await flushPromises();

    expect(w.text()).not.toContain(COPIADO);
  });

  it("valor vazio não dispara nada", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);

    const w = mountUi(LjCopyButton, { props: { value: "" }, slots: { default: "Copiar" } });
    await w.trigger("click");
    await flushPromises();

    expect(writeText).not.toHaveBeenCalled();
    expect(w.text()).not.toContain(COPIADO);
  });

  it("o aviso de copiado some depois da duração", async () => {
    vi.useFakeTimers();
    const w = mountUi(LjCopyButton, { props: { value: "x", duration: 3000 } });

    await w.trigger("click");
    await flushPromises();
    expect(w.text()).toContain(COPIADO);

    await vi.advanceTimersByTimeAsync(3100);
    expect(w.text()).not.toContain(COPIADO);
  });

  it("regressão: nenhuma API deprecada no componente", () => {
    /*
     * O comando de cópia deprecada do DOM habitou aqui como fallback de
     * contexto inseguro e o editor acusava deprecação (TS6387). A alternativa
     * moderna é o próprio `navigator.clipboard`, que já é o caminho principal.
     */
    const fonte = readFileSync(
      join(process.cwd(), "src/components/ui/LjCopyButton.vue"),
      "utf8"
    );
    expect(fonte).not.toContain("execCommand");
    expect(fonte).toContain("navigator.clipboard");
  });
});
