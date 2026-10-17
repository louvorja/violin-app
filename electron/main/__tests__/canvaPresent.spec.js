// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  ATIVOS_POR_SO,
  ATALHO_PADRAO,
  TECLA_ATALHO,
  TENTATIVAS_MS,
  ESPERA_CONTROLES_MS,
  modificadoresPara,
  candidatosNoCanto,
  escolherBotao,
  inspecionar,
  entrou,
  tentarApresentar,
  SCRIPT,
} = require("../canva/present.js");

/**
 * HTML real do botão da Canva (colado pelo operador), montado numa barra de
 * ferramentas de verdade — com o "?" no canto, que NÃO pode ser o alvo.
 */
const BARRA_CANVA = `
<div>
  <div class="xjp7ctv">
    <button type="button" aria-label="Apresentar em tela cheia" id="btn-present">
      <span aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24">
        <path d="M14.636 10.43 18.5 6.565v2.687a.75.75 0 0 0 1.5 0V5.497"></path>
      </svg></span>
    </button>
  </div>
</div>`;

function retangulo(left, top, width = 40, height = 40) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function botao(rotulo, caixa, { childLabel, id } = {}) {
  const el = document.createElement("button");
  if (rotulo) el.textContent = rotulo;
  if (id) el.id = id;
  if (childLabel) {
    const filho = document.createElement("span");
    filho.setAttribute("aria-label", childLabel);
    el.appendChild(filho);
  }
  el.getBoundingClientRect = () => caixa;
  document.body.appendChild(el);
  return el;
}

const DIREITA_BAIXO = retangulo(1800, 1000);

/** Janela falsa: sequência de estados lidos e eventos registrados. */
function janelaFake(sequencia) {
  let leitura = 0;
  const eventos = [];
  return {
    eventos,
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1920, height: 1080 }),
    webContents: {
      executeJavaScript: async () =>
        sequencia[Math.min(leitura++, sequencia.length - 1)] ?? null,
      sendInputEvent: (evento) => eventos.push(evento),
    },
  };
}

const VER = { fullscreen: false, botao: true, candidatos: 1, x: 0.95, y: 0.95 };
const TELA_CHEIA = { fullscreen: true, botao: false, candidatos: 0, x: 0, y: 0 };
const SEM_BOTAO = { fullscreen: false, botao: false, candidatos: 0, x: 0, y: 0 };
const RAPIDO = {
  atrasos: [1],
  folga: 1,
  modificadores: ["alt", "control"],
  /* A espera pós-apresentação tem teste próprio; aqui só atrasaria a suíte. */
  esperaControles: 0,
};

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 1080, configurable: true });
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
});

afterEach(() => {
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
});

describe("escolherBotao — acha o 'Apresentar em tela cheia'", () => {
  it("pega o botão do canto inferior direito", () => {
    const alvo = botao("Apresentar em tela cheia", DIREITA_BAIXO);
    expect(escolherBotao(document, window)).toBe(alvo);
  });

  it.each(["tela cheia", "Tela Cheia", "fullscreen", "Full screen", "Present", "Apresentar"])(
    "reconhece o rótulo em todas as grafias: %s",
    (rotulo) => {
      const alvo = botao(rotulo, DIREITA_BAIXO);
      expect(escolherBotao(document, window)).toBe(alvo);
    }
  );

  it("icone sem texto: o rótulo está no aria-label do filho", () => {
    const alvo = botao(null, DIREITA_BAIXO, { childLabel: "Apresentar em tela cheia" });
    expect(escolherBotao(document, window)).toBe(alvo);
  });

  it("fica de fora quem não está no canto", () => {
    botao("Apresentar em tela cheia", retangulo(1700, 40));
    botao("Apresentar em tela cheia", retangulo(60, 1000));
    expect(escolherBotao(document, window)).toBeNull();
  });

  it("fica de fora quem não fala de apresentação", () => {
    botao("Compartilhar", DIREITA_BAIXO);
    botao("Baixar", retangulo(1750, 1020));
    expect(escolherBotao(document, window)).toBeNull();
  });

  it("com dois candidatos, escolhe o mais próximo do canto", () => {
    const noMeio = botao("Present", retangulo(1100, 700));
    botao("Present", DIREITA_BAIXO);
    expect(escolherBotao(document, window)).not.toBe(noMeio);
  });

  it("já em tela cheia não clica — clicar de novo poderia SAIR", () => {
    botao("Apresentar em tela cheia", DIREITA_BAIXO);
    Object.defineProperty(document, "fullscreenElement", {
      value: document.body,
      configurable: true,
    });
    expect(escolherBotao(document, window)).toBeNull();
  });

  it("elemento minúsculo (ícone escondido) não serve", () => {
    botao("Apresentar em tela cheia", retangulo(1800, 1000, 4, 4));
    expect(escolherBotao(document, window)).toBeNull();
  });

  it("sem candidato não estoura: devolve null", () => {
    expect(escolherBotao(document, window)).toBeNull();
  });
});

describe("inspecionar — o que o main lê da página", () => {
  it("reconhece o HTML REAL da Canva e devolve o centro normalizado", () => {
    document.body.innerHTML = BARRA_CANVA;
    const alvo = document.getElementById("btn-present");
    alvo.getBoundingClientRect = () => retangulo(1700, 1020, 44, 44);

    const estado = inspecionar(document, window);

    expect(estado).toMatchObject({ fullscreen: false, botao: true, candidatos: 1 });
    /* Centro (1722,1042) / (1920,1080) — proporção, não pixel. */
    expect(estado.x).toBeCloseTo(1722 / 1920, 5);
    expect(estado.y).toBeCloseTo(1042 / 1080, 5);
    expect(estado.x).toBeGreaterThan(0.5);
    expect(estado.y).toBeGreaterThan(0.5);
  });

  it("o '?' do canto não vira candidato — só o de rótulo", () => {
    document.body.innerHTML = BARRA_CANVA;
    document.getElementById("btn-present").getBoundingClientRect = () => retangulo(1700, 1020);
    const ajuda = botao("Ajuda", retangulo(1860, 1020));

    const candidatos = candidatosNoCanto(document, window);
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0].el).not.toBe(ajuda);
    expect(inspecionar(document, window).candidatos).toBe(1);
  });

  it("sem barra montada ainda: botao=false, e NÃO é tela cheia", () => {
    expect(inspecionar(document, window)).toMatchObject({
      fullscreen: false,
      botao: false,
      candidatos: 0,
    });
  });

  it("em tela cheia sinaliza fullscreen", () => {
    botao("Apresentar em tela cheia", DIREITA_BAIXO);
    Object.defineProperty(document, "fullscreenElement", {
      value: document.body,
      configurable: true,
    });
    expect(inspecionar(document, window).fullscreen).toBe(true);
  });

  it("sem argumentos usa document/window globais (é como o SCRIPT roda)", () => {
    /* É por isso que a função pode ser serializada sem argumento nenhum. */
    expect(inspecionar()).toMatchObject({ fullscreen: false, botao: false });
  });
});

describe("entrou — o critério de sucesso", () => {
  it("tela cheia conta, mesmo sem histórico do botão", () => {
    expect(entrou({ fullscreen: true, botao: false }, false)).toBe(true);
  });

  it("botão sumindo DEPOIS de visto conta — a barra some no modo apresentação", () => {
    expect(entrou({ fullscreen: false, botao: false }, true)).toBe(true);
  });

  it("botão ausente no PRIMEIRO load NÃO conta: a barra pode ainda montar", () => {
    expect(entrou({ fullscreen: false, botao: false }, false)).toBe(false);
  });

  it("nada mudou → não entrou", () => {
    expect(entrou(VER, true)).toBe(false);
    expect(entrou(null, true)).toBe(false);
  });
});

describe("atalho por sistema operacional", () => {
  it("mapeia os três SO e cai no padrão do Linux/Windows para o desconhecido", () => {
    expect(modificadoresPara("darwin")).toEqual(["alt", "meta"]);
    expect(modificadoresPara("win32")).toEqual(["alt", "control"]);
    expect(modificadoresPara("linux")).toEqual(["alt", "control"]);
    expect(modificadoresPara("freebsd")).toEqual(ATALHO_PADRAO);
    expect(ATIVOS_POR_SO.linux).toEqual(ATIVOS_POR_SO.win32);
  });

  it("a tecla é a mesma em todo lugar — só os modificadores mudam", () => {
    expect(TECLA_ATALHO).toBe("P");
    expect(TENTATIVAS_MS.length).toBeGreaterThan(3);
  });
});

describe("tentarApresentar — o fluxo", () => {
  it("sai rápido quando JÁ está em apresentação: nenhum GESTO", async () => {
    const win = janelaFake([TELA_CHEIA, TELA_CHEIA]);

    expect(await tentarApresentar(win, RAPIDO)).toBe(true);
    /*
     * Nada de tecla e nada de clique: já estava pronto, mexer de novo podia
     * tirar da apresentação. O único evento é o empurrão final — que existe
     * para os controles sumirem, não é um gesto de entrada.
     */
    expect(win.eventos.map((e) => e.type)).toEqual(["mouseMove"]);
    expect(win.eventos[0]).toMatchObject({ x: 960, y: 540 });
  });

  it("atalho resolve: keyDown/keyUp com os modificadores do SO, sem clique", async () => {
    const win = janelaFake([VER, TELA_CHEIA, TELA_CHEIA]);

    expect(await tentarApresentar(win, { ...RAPIDO, modificadores: ["alt", "meta"] })).toBe(true);
    expect(win.eventos.map((e) => e.type)).toEqual(["keyDown", "keyUp", "mouseMove"]);
    expect(win.eventos[0]).toMatchObject({ keyCode: "P", modifiers: ["alt", "meta"] });
    expect(win.eventos.some((e) => e.type === "mouseDown")).toBe(false);
  });

  it("atalho não pegou → clique REAL com mouseMove/mouseDown/mouseUp", async () => {
    /* estado 1 = leitura inicial, 2 = pós-atalho, 3 = pós-clique */
    const win = janelaFake([VER, VER, TELA_CHEIA, TELA_CHEIA]);

    expect(await tentarApresentar(win, RAPIDO)).toBe(true);

    const tipos = win.eventos.map((e) => e.type);
    expect(tipos).toContain("keyDown");
    expect(tipos.indexOf("mouseMove")).toBeLessThan(tipos.indexOf("mouseDown"));
    expect(tipos.indexOf("mouseDown")).toBeLessThan(tipos.indexOf("mouseUp"));

    /* Coordenada proporcional × content bounds (1920×1080). */
    const clique = win.eventos.find((e) => e.type === "mouseDown");
    expect(clique).toMatchObject({ x: 1824, y: 1026, button: "left" });
  });

  it("sem alvo e sem tela cheia: não clica e devolve false", async () => {
    const win = janelaFake([SEM_BOTAO, SEM_BOTAO]);

    expect(await tentarApresentar(win, { ...RAPIDO, atrasos: [1, 1] })).toBe(false);
    expect(win.eventos.some((e) => e.type === "mouseDown")).toBe(false);
    /* O atalho é enviado mesmo sem botão visível: ele não depende do DOM. */
    expect(win.eventos.some((e) => e.type === "keyDown")).toBe(true);
  });

  it("segunda chamada simultânea não reentra (WeakSet)", async () => {
    const win = janelaFake([VER, TELA_CHEIA, TELA_CHEIA]);
    const primeira = tentarApresentar(win, RAPIDO);

    expect(await tentarApresentar(win, RAPIDO)).toBe(false);
    expect(await primeira).toBe(true);
  });

  it("janela destruída no meio aborta sem eventos", async () => {
    const win = janelaFake([VER, VER, TELA_CHEIA]);
    win.isDestroyed = () => true;

    expect(await tentarApresentar(win, RAPIDO)).toBe(false);
    expect(win.eventos).toEqual([]);
  });

  it("depois de confirmar, empurra o ponteiro para o CENTRO da tela", async () => {
    const win = janelaFake([VER, TELA_CHEIA, TELA_CHEIA]);

    await tentarApresentar(win, RAPIDO);

    /*
     * O clique que entrou na apresentação foi um ponteiro — reiniciou o
     * relógio de inatividade do Canva ali mesmo. O centro é o ponto neutro:
     * a barra fica nas bordas e passar por ela abriria menu.
     */
    expect(win.eventos[win.eventos.length - 1]).toMatchObject({
      type: "mouseMove",
      x: 960,
      y: 540,
    });
  });

  it("só devolve true DEPOIS da espera dos controles sumirem", async () => {
    const win = janelaFake([VER, TELA_CHEIA, TELA_CHEIA]);
    const inicio = Date.now();

    expect(await tentarApresentar(win, { ...RAPIDO, esperaControles: 150 })).toBe(true);

    /* O loader fica cobrindo a tela durante essa espera; é ela que garante
       que o fade não revele a barra de apresentação ainda visível. */
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(150);
  });

  it("quando NÃO confirmou, não há espera nem empurrão final", async () => {
    const win = janelaFake([SEM_BOTAO, SEM_BOTAO]);
    const inicio = Date.now();

    expect(
      await tentarApresentar(win, { ...RAPIDO, atrasos: [1, 1], esperaControles: 150 })
    ).toBe(false);

    expect(Date.now() - inicio).toBeLessThan(150);
    expect(win.eventos.filter((e) => e.type === "mouseMove")).toEqual([]);
  });

  it("a espera padrão é ESPERA_CONTROLES_MS", () => {
    expect(ESPERA_CONTROLES_MS).toBe(3000);
  });
});

describe("o script que vai para a página", () => {
  it("leva as três funções juntas — String(fn) não carrega auxiliares", () => {
    for (const nome of ["candidatosNoCanto", "escolherBotao", "inspecionar"]) {
      expect(SCRIPT).toContain(nome);
    }
    expect(SCRIPT).not.toContain("require(");
    expect(SCRIPT).not.toContain("tentarApresentar");
    expect(() => new Function(`return ${SCRIPT};`)()).not.toThrow();
  });

  it("é só leitura: não há clique nem mutação na página", () => {
    expect(SCRIPT).not.toContain(".click(");
    expect(SCRIPT).not.toContain("requestFullscreen");
    expect(SCRIPT).not.toContain("dispatchEvent");
  });
});
