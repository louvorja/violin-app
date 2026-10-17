"use strict";

/**
 * present.js — Traz a página do Canva para o modo de apresentação.
 *
 * O `view_url` abre a `VIEWER` de visualização: o conteúdo aparece, mas o
 * operador ainda precisa apertar "Apresentar em tela cheia" (canto inferior
 * direito) para chegar no ponto da projeção. O Canva não expõe isso por URL
 * (`/present` responde 404), então o app faz o gesto.
 *
 * ── Por que o clique sai por `sendInputEvent` e não por `.click()` ──────────
 *
 * A primeira versão chamava `executeJavaScript` e `botao.click()`. O log foi:
 *
 *     [canva] modo de apresentação acionado na projeção   (×2 — site e retorno)
 *
 * …e nada mudou na tela: o sintético nasce com `isTrusted: false` e o Chromium
 * não roda comportamento padrão com ele. É exatamente o que o próprio
 * `windowFactory.js` já documenta para esta mesma janela (ver o comentário do
 * pointer nudge): as teclas e o mouse daqui passaram a `sendInputEvent` por
 * terem sido medidos. O `requestFullscreen()` do Canva ainda exigiria ativação
 * de usuário, que só a entrada real fornece.
 *
 * Daí o desenho: `executeJavaScript` só LÊ (estado e coordenadas normalizadas)
 * e quem age é o main, mandando eventos de verdade. E "acionar" não é sucesso —
 * só o estado da página decide se entrou.
 */

/** Espera entre tentativas — a barra de ferramentas monta depois do load. */
const TENTATIVAS_MS = [1200, 2500, 4000, 6000, 9000, 12000];
/** Folga entre o gesto e a releitura do estado (transição da Canva).
 *  Folga grande de propósito: se a leitura vier cedo demais, o clique de
 *  reforço rodaria POR CIMA de um modo que já entrou e o tiraria de novo. */
const FOLGA_MS = 900;
/**
 * Espera depois de entrar, para os controles sumirem antes de a tela ser revelada.
 *
 * A barra de apresentação do Canva some por INATIVIDADE de ponteiro, e o
 * relógio dessa inatividade só anda depois que o site vê um evento de ponteiro.
 * O gesto que acabou de entrar na apresentação foi justamente um ponteiro (o
 * clique no botão), então o ciclo recomeça ALI — e a tela de loading do loader
 * de projeção cobriria os controles durante essa espera, em vez de revelar a
 * barra para depois esperar ela sumir.
 *
 * 3 s é o valor do plano (fixo, sem detecção por DOM): folga para o ciclo do
 * site rodar em máquina lenta, sem prender a tela tempo demais. Vira opção de
 * `tentarApresentar` para os testes ajustarem.
 */
const ESPERA_CONTROLES_MS = 3000;
const TECLA_ATALHO = "P";

/**
 * Modificadores do atalho por SO.
 *
 * O Canva só tem DOIS ramos — no bundle dele, `__c.Rb()` devolve `"apple"` ou
 * `"other"` —, então Linux cai junto com Windows. Fonte: documentação oficial
 * ("Presentation mode: Alt + Ctrl + P") e as tabelas de atalho, que trazem
 * `Ctrl+Alt+P` para Windows e `Command+Option+P` (o ⌥⌘P do macOS) para o Mac.
 */
const ATIVOS_POR_SO = Object.freeze({
  darwin: ["alt", "meta"],
  win32: ["alt", "control"],
  linux: ["alt", "control"],
});
const ATALHO_PADRAO = ["alt", "control"];

/** @param {string} [so] @returns {string[]} */
function modificadoresPara(so) {
  return ATIVOS_POR_SO[so || process.platform] || ATALHO_PADRAO;
}

/* -------------------------------------------------------------------------- */
/*  Dentro da página — funções puras, serializadas para o executeJavaScript    */
/* -------------------------------------------------------------------------- */

/**
 * Botões na metade de baixo E na metade direita, com rótulo de apresentação.
 * O mais próximo do canto vence.
 * @param {Document} d
 * @param {Window} w
 * @returns {{el: Element, distancia: number}[]}
 */
function candidatosNoCanto(d, w) {
  const largura = w.innerWidth || 0;
  const altura = w.innerHeight || 0;
  if (!largura || !altura) return [];

  const rotulo = (el) => {
    const bruto = [
      el.getAttribute && el.getAttribute("aria-label"),
      el.getAttribute && el.getAttribute("title"),
      el.getAttribute && el.getAttribute("data-testid"),
      /* `aria-labelledby` aponta para o texto real, que pode estar oculto. */
      (el.getAttribute && el.getAttribute("aria-labelledby") &&
        d.getElementById(el.getAttribute("aria-labelledby"))) ||
        null,
      el.textContent,
      el.querySelector && el.querySelector("[aria-label]"),
    ]
      .map((v) => (v && typeof v === "object" && v.getAttribute ? v.getAttribute("aria-label") : v))
      .filter((v) => typeof v === "string" && v)
      .join(" ");
    return bruto.toLowerCase();
  };

  const lista = [];
  for (const el of d.querySelectorAll('button, [role="button"], a[href], [tabindex]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.top < altura * 0.5) continue;
    if (r.left < largura * 0.5) continue;
    if (!/(apresent|tela cheia|fullscreen|full screen|present)/.test(rotulo(el))) continue;

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    lista.push({ el, distancia: Math.hypot(largura - cx, altura - cy) });
  }
  lista.sort((a, b) => a.distancia - b.distancia);
  return lista;
}

/**
 * Botão a apertar, ou `null` — inclusive quando já estamos em tela cheia
 * (clicar de novo poderia SAIR do modo de apresentação).
 */
function escolherBotao(doc, win) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  const w = win || (typeof window !== "undefined" ? window : null);
  if (!d || !w) return null;
  if (d.fullscreenElement) return null;
  const lista = candidatosNoCanto(d, w);
  return lista.length ? lista[0].el : null;
}

/**
 * Retorno lido pelo main. Só leitura — nenhuma mutação na página.
 *
 * `botao` sem `fullscreen` também pode significar "a barra ainda não montou";
 * por isso quem conclui é a TRANSIÇÃO (viu o botão e ele sumiu), nunca o
 * primeiro `botao:false`.
 *
 * `x`/`y` são o centro do botão em proporção da janela (0..1): o main multiplica
 * pelo tamanho do conteúdo e evita diferença de escala entre monitores.
 *
 * @returns {{fullscreen: boolean, botao: boolean, candidatos: number,
 *            x: number, y: number}|null}
 */
function inspecionar(doc, win) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  const w = win || (typeof window !== "undefined" ? window : null);
  if (!d || !w) return null;
  const largura = w.innerWidth || 0;
  const altura = w.innerHeight || 0;
  if (!largura || !altura) return null;

  const fullscreen = Boolean(d.fullscreenElement);
  const lista = candidatosNoCanto(d, w);
  const melhor = lista.length ? lista[0] : null;

  if (!melhor) {
    return { fullscreen, botao: false, candidatos: lista.length, x: 0, y: 0 };
  }
  const r = melhor.el.getBoundingClientRect();
  return {
    fullscreen,
    botao: true,
    candidatos: lista.length,
    x: (r.left + r.width / 2) / largura,
    y: (r.top + r.height / 2) / altura,
  };
}

/**
 * Fonte serializada para o renderer da Canva: as três juntas num IIFE, porque
 * `String(fn)` leva só o corpo da função — as auxiliares não viajariam.
 */
const SCRIPT = `(() => {
${[candidatosNoCanto, escolherBotao, inspecionar].map(String).join("\n")}
return inspecionar();
})()`;

/* -------------------------------------------------------------------------- */
/*  No main                                                                    */
/* -------------------------------------------------------------------------- */

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * Janela com tentativa em voo. Um `did-finish-load` a mais (reload, troca de
 * rota) dispararia uma segunda varredura; sem isto, duas entradas simultâneas
 * no mesmo botão.
 */
const _apresentando = new WeakSet();

async function inspecionarJanela(win) {
  try {
    const estado = await win.webContents.executeJavaScript(SCRIPT, true);
    return estado && typeof estado === "object" ? estado : null;
  } catch (_) {
    /* Página em transição ou webContents indisponível — tenta de novo. */
    return null;
  }
}

/** Modo de apresentação confirmado: tela cheia OU a barra de ferramentas sumiu. */
function entrou(estado, viuBotao) {
  if (!estado) return false;
  if (estado.fullscreen) return true;
  /* Transição: só vale se já tínhamos visto o botão — `botao:false` sozinho
     pode ser "a barra ainda não montou". */
  return viuBotao && !estado.botao;
}

function enviarAtalho(win, modificadores) {
  /* keyDown e keyUp com os mesmos modificadores: o Canva lê as flags do evento. */
  for (const type of ["keyDown", "keyUp"]) {
    win.webContents.sendInputEvent({ type, keyCode: TECLA_ATALHO, modifiers: modificadores });
  }
}

/**
 * Clique de verdade na posição do botão.
 *
 * `sendInputEvent` entra na fila de entrada real (medido nesta janela pelo
 * pointer nudge), e é isso que dá ao Canva a ativação de usuário que o
 * `requestFullscreen()` dele exige. Coordenadas são proporcionais: o main
 * multiplica pelo tamanho do conteúdo, então escala de monitor não conta.
 */
async function clicar(win, estado) {
  const { width, height } = win.getContentBounds();
  const x = Math.round(estado.x * width);
  const y = Math.round(estado.y * height);

  win.webContents.sendInputEvent({ type: "mouseMove", x, y });
  await dormir(80);
  win.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  await dormir(60);
  win.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

/**
 * Tenta levar a janela ao modo de apresentação — só a tentativa, sem a espera
 * final. Exportado como `tentarApresentar` abaixo.
 *
 * Ordem: já está? → sai. Atalho do SO → confere. Clique real → confere.
 * Repete enquanto a barra ainda não apareceu. `false` significa "não
 * confirmou", não "não cliquei" — o log leva o estado para o diagnóstico.
 *
 * @param {Electron.BrowserWindow} win
 * @param {{atrasos?: number[], modificadores?: string[], folga?: number}} [opts]
 * @returns {Promise<boolean>} true se o modo de apresentação foi confirmado
 */
async function _tentar(win, opts = {}) {
  const atrasos = opts.atrasos || TENTATIVAS_MS;
  const folga = opts.folga ?? FOLGA_MS;
  const modificadores = opts.modificadores || modificadoresPara();
  let viuBotao = false;
  let ultimo = null;

  for (const ms of atrasos) {
    await dormir(ms);
    if (!win || win.isDestroyed()) return false;

    let estado = await inspecionarJanela(win);
    if (!estado) continue;
    ultimo = estado;
    if (entrou(estado, viuBotao)) return true;
    if (estado.botao) viuBotao = true;

    /* 1) o atalho do SO — um gesto, sem depender do DOM. */
    enviarAtalho(win, modificadores);
    await dormir(folga);
    estado = await inspecionarJanela(win);
    if (estado) {
      ultimo = estado;
      if (entrou(estado, viuBotao)) {
        console.log(`[canva] apresentação via atalho (${modificadores.join("+")}+${TECLA_ATALHO})`);
        return true;
      }
    }

    /* 2) clique real na posição lida — o atalho pode não ter pegado. */
    const alvo = ultimo;
    if (alvo && alvo.botao) {
      await clicar(win, alvo);
      await dormir(folga);
      estado = await inspecionarJanela(win);
      if (estado) {
        ultimo = estado;
        if (entrou(estado, viuBotao)) {
          console.log("[canva] apresentação via clique no botão do canto");
          return true;
        }
      }
    }
    /* Continua: a barra pode estar só montando. */
  }

  console.info(
    `[canva] apresentação não confirmada — fullscreen=${ultimo?.fullscreen}, ` +
      `botao=${ultimo?.botao}, candidatos=${ultimo?.candidatos}`
  );
  return false;
}

/**
 * Empurrão de ponteiro DEPOIS de entrar, e a espera dos controles sumirem.
 *
 * É o segundo empurrão desta janela: o de `windowFactory.js` roda no
 * `did-finish-load`, antes de qualquer apresentação, e serve só para o site
 * ENXERGAR um ponteiro pela primeira vez. Este roda depois do gesto — e o
 * gesto foi um clique, ou seja, um ponteiro que reiniciou o relógio de
 * inatividade do Canva naquele exato instante. Sem mover de novo para o
 * centro e esperar, a tela seria revelada com a barra de apresentação ainda
 * visível.
 *
 * Centro, e não borda: a barra fica nas bordas e passar o ponteiro por ela
 * abriria menu ou tooltip. O centro é o ponto neutro de uma apresentação.
 *
 * `getContentBounds`: as coordenadas do `sendInputEvent` são do conteúdo
 * (webContents), não da janela.
 */
async function _esconderControles(win, opts) {
  const espera = opts.esperaControles ?? ESPERA_CONTROLES_MS;
  try {
    const { width, height } = win.getContentBounds();
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(width / 2),
      y: Math.round(height / 2),
    });
  } catch (_) {
    /* Janela fechou entre a confirmação e o empurrão. */
  }
  if (espera > 0) await dormir(espera);
}

/**
 * Tenta levar a janela ao modo de apresentação e deixa os controles sumirem
 * antes de devolver `true`.
 *
 * `true` aqui significa "a tela está pronta para ser vista": modo de
 * apresentação confirmado E a espera de `ESPERA_CONTROLES_MS` decorrida. É o
 * sinal que o loader de projeção de Site usa para começar o fade — se ele
 * saísse na confirmação, revelaria a barra de controles e o operador veria a
 * tela "acabando de se arrumar".
 *
 * @param {Electron.BrowserWindow} win
 * @param {{atrasos?: number[], modificadores?: string[], folga?: number,
 *          esperaControles?: number}} [opts]
 * @returns {Promise<boolean>} true se a apresentação foi confirmada
 */
async function tentarApresentar(win, opts = {}) {
  if (!win || _apresentando.has(win)) return false;
  _apresentando.add(win);
  try {
    const confirmou = await _tentar(win, opts);
    if (confirmou) await _esconderControles(win, opts);
    return confirmou;
  } finally {
    _apresentando.delete(win);
  }
}

module.exports = {
  ATIVOS_POR_SO,
  ATALHO_PADRAO,
  TECLA_ATALHO,
  TENTATIVAS_MS,
  FOLGA_MS,
  ESPERA_CONTROLES_MS,
  modificadoresPara,
  candidatosNoCanto,
  escolherBotao,
  inspecionar,
  entrou,
  tentarApresentar,
  SCRIPT,
};
