"use strict";

/**
 * @category helper-puro — O que uma `route` vira na janela.
 *
 * Separa da janela em si de propósito: decide alvo de `loadURL` e as
 * preferências de segurança sem tocar em Electron, o que dá para exercitar em
 * teste puro. Três decisões vivem aqui, e todas já quebraram alguma vez:
 *
 * - rota da SPA (`/projection/file`) vira `louvorja://app/index.html#…`;
 * - URL externa (item de liturgia do tipo Site) é carregada direto, porque
 *   encaminhar `https://…` para o router daria a tela de 404;
 * - URL externa NÃO recebe o preload do app nem a sessão do app.
 */

/**
 * Partição da janela que mostra um site externo.
 *
 * É a correção do CSP injetado em resposta de terceiro: `main.cjs` registra
 * `onHeadersReceived` na `session.defaultSession` para dar ao app o seu
 * `dev-desktop` CSP, e sem partição toda resposta vinda do site levava aquela
 * política — o `script-src` e o `style-src` do app não contêm a origem do
 * site, e o navegador bloqueava o script e o stylesheet dele. O interceptor
 * vale só para a sessão em que foi registrado, então outra partição é o que
 * devolve ao site apenas o CSP dele.
 *
 * `persist:` de propósito: um enquete que o operador projeta várias vezes
 * mantém cookies e estado entre cultos, e fica isolado do cookie jar do app.
 * Sem o prefixo o estado morre a cada reinício do app.
 */
const SITE_PARTITION = "persist:lj-site";

/**
 * A `route` é uma URL externa em vez de rota da SPA?
 *
 * Precisa ser http/https com host: `//evil.com` resolveria relativo à origem
 * atual e `javascript:`/`file:` não podem chegar ao `loadURL` de uma janela de
 * projeção. O `trim` é porque quem preenche o campo (form de liturgia) não
 * limpa, e `" https://…"` cairia no ramo da SPA.
 */
function isExternalRoute(route) {
  return /^https?:\/\/[^/\s]+/i.test(String(route || "").trim());
}

/**
 * O que a janela carrega. Pura: é o que os testes exercitam sem Electron.
 * Devolve `{ kind, url }` — `none` quando não há alvo (sem devUrl nem html),
 * para quem chama não mandar `loadURL("")`.
 */
function loadTargetFor(route, { devUrl = "", prodHtmlPath = "" } = {}) {
  const texto = String(route || "").trim();
  if (isExternalRoute(texto)) return { kind: "external", url: texto };
  if (devUrl) return { kind: "dev", url: `${devUrl}${texto}` };
  if (prodHtmlPath) {
    // Origem real (não null): é o que habilita BroadcastChannel entre janelas,
    // fetch relativo e secure context. O router em hash mode preserva a rota.
    const cleanRoute = texto.startsWith("/") ? texto : `/${texto}`;
    return { kind: "app", url: `louvorja://app/index.html#${cleanRoute}` };
  }
  return { kind: "none", url: "" };
}

/**
 * Preferências de segurança que dependem só da `route`.
 *
 * A janela externa vira uma janela de navegação: sem o `preload` (que expõe
 * `louvorjaApi` sem gate de origem — `userStore`, `windows`, `httpServer` iam
 * para qualquer site), com sandbox ligado e fora da sessão do app. A janela
 * interna mantém o comportamento de sempre.
 */
function webPreferencesFor(route, { preloadPath } = {}) {
  if (isExternalRoute(route)) {
    return { preload: undefined, sandbox: true, partition: SITE_PARTITION };
  }
  return { preload: preloadPath, sandbox: false };
}

/**
 * O host é do Canva? Só `canva.com` (com subdomínio) — `evilcanva.com` não.
 * @param {string} url
 */
function hostCanva(url) {
  try {
    return /(^|\.)canva\.com$/i.test(new URL(String(url)).hostname);
  } catch (_) {
    return false;
  }
}

/**
 * A URL é uma tela de login (ou de desafio) do Canva?
 *
 * Duas decisões dependem dela: a janela de login saber quando o operador
 * terminou, e a projeção avisar que caiu na tela de login. Por isso é pura e
 * mora aqui, junto do contrato de URL da janela.
 *
 * `includes` e não `startsWith`: o Canva serve `/<locale>/login` em alguns
 * mercados, e um `startsWith("/login")` classificava aquilo como "já logado" —
 * foi exatamente isso que fechou a janela de login antes de o operador
 * digitar qualquer coisa.
 *
 * Só canva.com: um link de liturgia que termina em `/login` de outro site não
 * pode disparar o aviso do Canva.
 */
function ehPaginaDeLogin(url) {
  if (!hostCanva(url)) return false;
  let caminho;
  try {
    caminho = new URL(String(url)).pathname.toLowerCase();
  } catch (_) {
    return false;
  }
  if (caminho.includes("/login")) return true;
  if (caminho.includes("/signup")) return true;
  if (caminho.includes("/logout")) return true;
  /* Desafio do Cloudflare: também não é o design. */
  if (caminho.startsWith("/cdn-cgi/")) return true;
  return false;
}

module.exports = {
  SITE_PARTITION,
  isExternalRoute,
  loadTargetFor,
  webPreferencesFor,
  ehPaginaDeLogin,
  hostCanva,
};
