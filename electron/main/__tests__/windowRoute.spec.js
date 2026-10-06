// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SITE_PARTITION, isExternalRoute, loadTargetFor, webPreferencesFor } = require("../windowRoute.js");

const DEV = { devUrl: "http://localhost:5002", prodHtmlPath: "" };
const PROD = { devUrl: "", prodHtmlPath: "/app/dist/index.html" };

describe("isExternalRoute", () => {
  it("aceita http e https com host", () => {
    expect(isExternalRoute("https://louvorja.com.br/enquete")).toBe(true);
    expect(isExternalRoute("http://192.168.1.10:8080")).toBe(true);
    expect(isExternalRoute("HTTPS://Exemplo.com/a?b=1#c")).toBe(true);
  });

  it("aceita com espaços nas pontas, que o campo do form não tira", () => {
    // `Liturgy.validateUrl` não limpa: sem isto " https://…" viraria rota da
    // SPA e o load final seria `localhost:5002 https://…`.
    expect(isExternalRoute("   https://exemplo.com/poll  ")).toBe(true);
  });

  it.each([
    ["rota da SPA", "/projection/file"],
    ["rota sem barra inicial", "projection/file"],
    ["protocolo não HTTP", "javascript:alert(1)"],
    ["arquivo local", "file:///etc/passwd"],
    ["protocolo do app", "louvorja://app/index.html#/projection"],
    ["host relativo (resolveria na origem atual)", "//evil.com"],
    ["vazio", ""],
    ["indefinido", undefined],
    ["quase URL, sem host", "https://"],
  ])("recusa %s", (_caso, route) => {
    expect(isExternalRoute(route)).toBe(false);
  });
});

describe("loadTargetFor", () => {
  it("URL externa carrega direto, mesmo havendo dev server", () => {
    // Sem esta saída o dev montaria `localhost:5002https://…`.
    const target = loadTargetFor("https://exemplo.com/poll", DEV);
    expect(target).toEqual({ kind: "external", url: "https://exemplo.com/poll" });
    expect(target.url).not.toContain(DEV.devUrl);
  });

  it("URL externa preserva query e fragmento", () => {
    const url = "https://exemplo.com/?a=1&b=2#topo";
    expect(loadTargetFor(url, PROD).url).toBe(url);
  });

  it("rota interna em dev aponta para o Vite", () => {
    expect(loadTargetFor("/projection/file", DEV)).toEqual({
      kind: "dev",
      url: "http://localhost:5002/projection/file",
    });
  });

  it("rota interna em prod usa o protocolo do app com hash", () => {
    expect(loadTargetFor("/projection/file", PROD)).toEqual({
      kind: "app",
      url: "louvorja://app/index.html#/projection/file",
    });
  });

  it("rota sem barra inicial ganha a barra", () => {
    // Vem do caminho antigo do windowFactory: sem isto o URL final ficaria
    // `…/index.html#projection` e o router não encontraria.
    expect(loadTargetFor("projection", PROD).url).toBe("louvorja://app/index.html#/projection");
  });

  it("sem devUrl e sem html, não há alvo", () => {
    expect(loadTargetFor("/projection", { devUrl: "", prodHtmlPath: "" })).toEqual({
      kind: "none",
      url: "",
    });
  });

  it("URL externa vence qualquer alvo de SPA", () => {
    expect(loadTargetFor("http://exemplo.com", DEV).kind).toBe("external");
    expect(loadTargetFor("http://exemplo.com", PROD).kind).toBe("external");
    expect(loadTargetFor("http://exemplo.com").kind).toBe("external");
  });
});

describe("webPreferencesFor", () => {
  const PRELOAD = "/app/electron/preload.cjs";

  it("URL externa sai sem preload, com sandbox e fora da sessão do app", () => {
    const prefs = webPreferencesFor("https://exemplo.com/poll", { preloadPath: PRELOAD });

    // Sem preload: `louvorjaApi` tem `userStore`, `windows` e `httpServer` e
    // não tem gate de origem — o site abriria com acesso a tudo.
    expect(prefs.preload).toBeUndefined();
    expect(prefs.sandbox).toBe(true);
    // É a partição que tira a janela da `defaultSession`, onde o `onHeadersReceived`
    // do `main.cjs` escreve o CSP do app em toda resposta — o que bloqueava o
    // script e o stylesheet do site.
    expect(prefs.partition).toBe(SITE_PARTITION);
  });

  it("a partição é persistente: o enquete do operador guarda estado entre cultos", () => {
    expect(SITE_PARTITION.startsWith("persist:")).toBe(true);
  });

  it("rota interna mantém o preload do app e a sessão de sempre", () => {
    const prefs = webPreferencesFor("/projection/file", { preloadPath: PRELOAD });

    expect(prefs.preload).toBe(PRELOAD);
    expect(prefs.sandbox).toBe(false);
    // Sem partição nenhuma: a janela continua na defaultSession, para o CSP e
    // o BroadcastChannel continuarem funcionando como hoje.
    expect(prefs).not.toHaveProperty("partition");
  });

  it("URL externa com espaços ainda é tratada como externa", () => {
    expect(webPreferencesFor("  https://exemplo.com  ", { preloadPath: PRELOAD }).preload)
      .toBeUndefined();
  });
});
