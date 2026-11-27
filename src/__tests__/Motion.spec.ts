import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O contrato de movimento da interface (docs/design-system.md, "Animações e
 * Transições"): o que muda de lugar usa mola, e mola só anda em `transform`.
 *
 * Nada aqui dá erro quando quebra. Uma mola posta em `height` continua
 * animando — só que refaz o layout da tela a cada quadro, no PC de igreja, no
 * meio do culto. Uma mola com ultrapassagem posta em `opacity` continua
 * animando — só que pisca. E um navegador sem `linear()` que receba a curva
 * sem reserva não anima nada: a declaração inteira é descartada e a camada
 * aparece seca. Por isso o teste é de fonte.
 */
const read = (path: string) => readFileSync(path, "utf8");

function filesIn(dir: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // Biblioteca de terceiros embutida e os próprios testes não são interface.
      if (name === "__tests__" || name === "dependencies") continue;
      found.push(...filesIn(path, extensions));
    } else if (extensions.some((ext) => name.endsWith(ext))) {
      found.push(path);
    }
  }
  return found;
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const SPRING_TOKEN = /--lj-motion-|--lj-ease-spring/;

/** Cada `transition: a, b, c;` de um arquivo, já partido em seus trechos. */
function transitionParts(source: string): string[] {
  const parts: string[] = [];
  for (const [, value] of stripComments(source).matchAll(/[\s;{]transition:\s*([^;}]+)[;}]/g)) {
    // A vírgula separa as transições — menos a que está dentro de parênteses.
    parts.push(...value.split(/,(?![^(]*\))/).map((part) => part.trim()));
  }
  return parts;
}

describe("tokens de mola", () => {
  const tokens = stripComments(read("src/assets/styles/tokens.css"));
  const SUPPORTS = "@supports (transition-timing-function";

  it("as duas molas têm reserva em cubic-bezier fora do @supports", () => {
    const beforeSupports = tokens.slice(0, tokens.indexOf(SUPPORTS));
    expect(beforeSupports).toMatch(/--lj-ease-spring:\s*cubic-bezier\(/);
    expect(beforeSupports).toMatch(/--lj-ease-spring-bounce:\s*cubic-bezier\(/);
    expect(
      beforeSupports,
      "linear() fora do @supports: navegador antigo descarta a transição inteira"
    ).not.toMatch(/linear\(/);
  });

  it("o @supports troca a reserva pelas curvas de mola", () => {
    const insideSupports = tokens.slice(tokens.indexOf(SUPPORTS));
    expect(insideSupports).toMatch(/--lj-ease-spring:\s*linear\(/);
    expect(insideSupports).toMatch(/--lj-ease-spring-bounce:\s*linear\(/);
  });

  it("a mola padrão não passa do alvo; a de quique passa pouco", () => {
    const curvePoints = (token: string) => {
      const match = tokens.match(new RegExp(`${token}:\\s*linear\\(([^)]+)\\)`));
      expect(match, `${token} em linear()`).not.toBeNull();
      return match![1].split(",").map((value) => Number(value.trim()));
    };

    const standard = curvePoints("--lj-ease-spring");
    expect(Math.max(...standard), "painel ancorado numa borda não pode abrir fresta").toBe(1);
    expect(standard.at(-1)).toBe(1);

    const bounce = curvePoints("--lj-ease-spring-bounce");
    expect(Math.max(...bounce)).toBeGreaterThan(1);
    expect(Math.max(...bounce), "mais que 8% vira brinquedo").toBeLessThanOrEqual(1.08);
    expect(bounce.at(-1)).toBe(1);
  });

  it("os tempos saem dos tokens de mola", () => {
    for (const speed of ["fast", "normal"]) {
      expect(tokens).toMatch(
        new RegExp(`--lj-motion-${speed}:\\s*[\\d.]+s var\\(--lj-ease-spring\\);`)
      );
    }
    expect(tokens).toMatch(/--lj-motion-bounce:\s*[\d.]+s var\(--lj-ease-spring-bounce\);/);
  });
});

describe("mola só em transform", () => {
  // O indicador das abas estica a largura junto com o deslocamento. É absoluto,
  // fora do fluxo: mudar a largura dele não refaz o layout de mais ninguém.
  const EXCEPTIONS: Record<string, string[]> = {
    "src/components/ui/LjTabs.vue": ["width"],
  };

  const sources = filesIn("src", [".vue", ".css"]);

  it("nenhuma transição põe mola em propriedade de layout, cor ou opacidade", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      for (const part of transitionParts(read(file))) {
        if (!SPRING_TOKEN.test(part)) continue;
        const property = part.split(/\s+/)[0];
        if (["transform", "translate", "scale", "rotate"].includes(property)) continue;
        if (EXCEPTIONS[file.replaceAll("\\", "/")]?.includes(property)) continue;
        offenders.push(`${file}: ${part}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("o que anima largura ou altura usa o par curto de reflow", () => {
    const accordion = read("src/components/ui/LjAccordion.vue");
    expect(accordion).toMatch(/lj-accordion-abre var\(--lj-reflow-enter\)/);
    expect(accordion).toMatch(/lj-accordion-fecha var\(--lj-reflow-exit\)/);

    const drawer = read("src/components/ui/LjDrawer.vue");
    expect(drawer).toMatch(/transition: width var\(--lj-reflow-enter\)/);
    expect(drawer).toMatch(/transition: width var\(--lj-reflow-exit\)/);
  });

  it("reflow e saída são curvas, nunca mola", () => {
    const tokens = stripComments(read("src/assets/styles/tokens.css"));
    for (const token of ["reflow-enter", "reflow-exit", "exit-fast", "exit-panel"]) {
      const value = tokens.match(new RegExp(`--lj-${token}:\\s*([^;]+);`))?.[1] ?? "";
      expect(value, token).toMatch(/^\d+ms var\(--lj-ease-(in|out)\)$/);
    }
  });
});

describe("o que anda junto usa o mesmo token", () => {
  // Um `transform` que acompanha uma mudança de layout precisa do tempo e da
  // curva dela, nas duas direções. Com tokens diferentes os dois se descolam
  // no meio do caminho e aparece uma faixa vazia entre eles.
  const shell = stripComments(read("src/views/Shell.vue"));

  it("rodapé do player e padding do conteúdo", () => {
    const footer = stripComments(read("src/layout/Footer.vue"));
    expect(shell).toMatch(/transition: padding-bottom var\(--lj-reflow-enter\)/);
    const rules = [...footer.matchAll(/\.footer(--active)? \{([^}]*)\}/g)].map((m) => m[2]);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const body of rules.filter((b) => b.includes("transition"))) {
      expect(body).toMatch(/transform var\(--lj-reflow-enter\)/);
    }
  });

  it("chat pinado e margem do conteúdo", () => {
    const chat = stripComments(read("src/components/ChatDrawer.vue"));
    expect(shell).toMatch(/transition: margin-left var\(--lj-reflow-enter\)/);
    expect(chat).toMatch(
      /\.chat-drawer-panel--pinned\.chat-drawer-slide-enter-active,\s*\.chat-drawer-panel--pinned\.chat-drawer-slide-leave-active \{\s*transition: transform var\(--lj-reflow-enter\)/
    );
  });
});

describe("troca de página", () => {
  const ui = stripComments(read("src/assets/styles/ui.css"));
  const container = stripComments(read("src/components/ModuleContainer.vue"));
  const swap = read("src/composables/useModuleSwap.ts");
  const seconds = (token: string) => {
    const match = stripComments(read("src/assets/styles/tokens.css")).match(
      new RegExp(`${token}:\\s*([\\d.]+)(m?s)`)
    );
    if (!match) throw new Error(`token ${token} não encontrado`);
    return match[2] === "ms" ? Number(match[1]) / 1000 : Number(match[1]);
  };

  it("o deslize usa mola e a opacidade usa curva, em animações separadas", () => {
    expect(ui).toMatch(
      /\.lj-page-in \{\s*animation:\s*lj-page-slide var\(--lj-motion-normal\),\s*lj-page-fade var\(--lj-transition-normal\);/
    );
  });

  it("a entrada não fica 'em vigor' depois de acabar", () => {
    // `forwards`/`both` num keyframe de `transform` mantém o elemento como
    // bloco de referência dos filhos `position: fixed` para sempre: a tela
    // cheia do sorteio passaria a se posicionar pelo módulo, não pela janela.
    const rule = ui.match(/\.lj-page-in \{[^}]+\}/)?.[0] ?? "";
    expect(rule).not.toMatch(/\b(both|forwards)\b/);
  });

  // Um fade de entrada sobre o vazio mostra o que está atrás: medido no Chrome,
  // 12 de 18 trocas tinham um quadro inteiro da cor do tema, e saindo do
  // Relógio (preto) havia um clarão branco. Quem sai fica desenhado por baixo.
  it("o módulo que sai continua no DOM enquanto o próximo entra", () => {
    const template = read("src/layout/Modules.vue").split("<script")[0];
    const transitions =
      template.replace(/<!--[\s\S]*?-->/g, "").match(/<Transition[\s\S]*?>/g) ?? [];
    expect(transitions).toHaveLength(2);
    for (const tag of transitions) {
      // O Transition só segura a saída; quem anima é o CSS do próprio módulo.
      expect(tag).toMatch(/:css="false"/);
      expect(tag).toMatch(/@before-enter="markEnteringPage"/);
      expect(tag).toMatch(/@leave="holdLeavingPage"/);
      // Voltar à aba no meio da saída precisa desarmar as esperas pendentes.
      expect(tag).toMatch(/@leave-cancelled="cancelLeavingPage"/);
    }
  });

  it("a espera de quem sai cobre a entrada inteira de quem chega", () => {
    const leaveMs = Number(swap.match(/PAGE_LEAVE_MS = (\d+)/)?.[1]);
    expect(leaveMs / 1000).toBeGreaterThanOrEqual(seconds("--lj-motion-normal"));
    // O fundo de .shell-content troca de cor no mesmo prazo (Shell.vue).
    expect(stripComments(read("src/views/Shell.vue"))).toMatch(
      new RegExp(`transition: background-color 0s linear ${leaveMs / 1000}s;`)
    );
  });

  it("quem entra fica por cima só durante a troca", () => {
    expect(ui).toMatch(/\[data-page\^="entering"\] \{\s*z-index: 1;\s*\}/);
    // Fixo, o z-index prenderia dentro do módulo quem precisa cobrir a janela.
    expect(container.match(/\.module-embedded \{[^}]+\}/)?.[0]).not.toMatch(/z-index/);
  });

  it("o papel de cada módulo vai no DOM, não em binding reativo", () => {
    // Um `:class` no ModuleContainer refaz o render dele — e o slot inteiro do
    // módulo — três vezes por troca.
    expect(read("src/components/ModuleContainer.vue")).not.toMatch(/data-page|dataset\.page/);
    expect(read("src/layout/Modules.vue")).toMatch(
      /dataset\.page = enteringOverModule \? "entering-over" : "entering"/
    );
  });

  it("a direção vem de quem navega: horizontal para abas, vertical para listas", () => {
    expect(ui).toMatch(
      /calc\(var\(--lj-nav-x, 0\) \* var\(--lj-enter-page-shift\)\),\s*calc\(var\(--lj-nav-y, 0\) \* var\(--lj-enter-page-shift\)\)/
    );
    // O menu do app empilha os itens: a tela entra pelo lado do item escolhido.
    const appMenu = read("src/layout/shell/AppMenu.vue");
    expect(appMenu).toMatch(/'--lj-nav-y': screenDirection, '--lj-nav-x': 0/);
    expect(stripComments(appMenu)).toMatch(
      /translateY\(calc\(var\(--lj-nav-y, 0\) \* var\(--lj-enter-page-shift\)\)\)/
    );
    // Abas lado a lado: o painel entra pelo lado da aba.
    for (const file of [
      "src/layout/shell/AppMenuSincronizar.vue",
      "src/layout/shell/AppMenuAcessibilidade.vue",
      "src/modules/overlay/components/OverlaySlotEditor.vue",
      "src/views/remote_control/RemoteControl.vue",
    ]) {
      expect(read(file), file).toMatch(/'--lj-nav-x': tabDirection, '--lj-nav-y': 0/);
    }
  });

  it("entre dois módulos a página entra opaca — esmaecer mistura as duas telas", () => {
    expect(ui).toMatch(/from \{\s*opacity: var\(--lj-page-from-opacity, 0\);/);
    expect(read("src/layout/Modules.vue")).toMatch(
      /setProperty\("--lj-page-from-opacity", enteringOverModule \? "1" : "0"\)/
    );
    // Uma regra que trocasse a lista de animações por `data-page` faria a
    // esmaecida recomeçar do zero quando o atributo sai, no fim da entrada.
    expect(ui).not.toMatch(/\[data-page="entering-over"\] \{[^}]*animation/);
  });

  it("trocado por outro módulo, quem sai deixa de ser desenhado na hora", () => {
    // A página nova entra deslocada 12px; na faixa que ela ainda não cobriu
    // aparecia um pedaço da tela anterior.
    const rule = ui.match(/\[data-page="leaving"\] \{[^}]+\}/)?.[0] ?? "";
    expect(rule).toMatch(/visibility: hidden;/);
    expect(rule).toMatch(/z-index: 0;/);
    expect(ui).toMatch(/\[data-page\^="entering"\] \{\s*z-index: 1;\s*\}/);
  });

  it("a página não muda de tamanho ao entrar", () => {
    // Já entrou 2% maior para cobrir a faixa de 12px da borda: o texto inteiro
    // pulsava a cada troca de aba.
    expect(ui).not.toMatch(/--lj-page-cover/);
    expect(read("src/layout/Modules.vue")).not.toMatch(/--lj-page-cover/);
  });

  it("fechar uma aba é a página fechada que some, não a vizinha que entra", () => {
    const rule =
      ui.match(/\[data-page="closing"\],\s*\[data-page="leaving-home"\] \{[^}]+\}/)?.[0] ?? "";
    expect(rule).toMatch(/z-index: 2;/);
    expect(rule).toMatch(/animation: lj-page-close var\(--lj-exit-panel\) both;/);
    expect(read("src/layout/Modules.vue")).toMatch(/closingModule \? "closing" : "leaving"/);
  });

  it("a faixa de abas anima entrada, saída e reacomodação sem TransitionGroup", () => {
    const tabs = read("src/layout/shell/OpenModulesTabs.vue");
    // O vuedraggable 4.1 dentro de um <TransitionGroup> não cria o Sortable: a
    // faixa deixa de aceitar arrasto, sem erro nenhum.
    expect(tabs).not.toMatch(/tag="transition-group"/);
    const css = stripComments(tabs.split("<style")[1] ?? "");
    expect(css).toMatch(
      /\.subtab\.subtab--entering \{\s*animation:\s*subtab-in var\(--lj-motion-fast\),\s*subtab-fade-in var\(--lj-transition-fast\);/
    );
    expect(css).toMatch(
      /\.subtab\.subtab--leaving \{[^}]*animation: subtab-out var\(--lj-exit-fast\) both;/
    );
    expect(css).toMatch(
      /\.subtab\.subtab--moving \{\s*transition: transform var\(--lj-motion-fast\);/
    );
    // Animação de entrada permanente em `.subtab` (mesmo desligada durante o
    // arrasto) reinicia em todas as abas quando volta a valer — a faixa inteira
    // pisca ao reordenar. Só `subtab--entering` carrega a entrada.
    expect(css).not.toMatch(/\.subtabs--dragging \.subtab/);
  });

  it("quem recebe painel com direção corta o deslocamento antes da rolagem", () => {
    // Deslocado para baixo ou para a direita, o painel aumenta a área de
    // rolagem do container e a barra de rolagem pisca.
    expect(stripComments(read("src/views/Shell.vue"))).toMatch(
      /\.shell-content--has-module \{[^}]*overflow: clip;/
    );
    expect(stripComments(read("src/layout/shell/AppMenu.vue"))).toMatch(
      /\.app-menu-screen-clip \{[^}]*overflow: clip;/
    );
    expect(stripComments(read("src/views/remote_control/RemoteControl.vue"))).toMatch(
      /\.rc-content \{[^}]*overflow-x: hidden;/
    );
    expect(stripComments(read("src/modules/overlay/components/Index.vue"))).toMatch(
      /\.overlay-slot-editor \{[^}]*overflow-x: clip;/
    );
    // O corpo da ribbon rola na horizontal: ali só a esmaecida.
    expect(read("src/layout/shell/RibbonGroupComponent.vue")).toMatch(
      /class="ribbon-group lj-fade-in"/
    );
  });

  it("as amplitudes de entrada saem dos tokens", () => {
    const tokens = stripComments(read("src/assets/styles/tokens.css"));
    for (const token of [
      "--lj-enter-layer-shift",
      "--lj-enter-layer-scale",
      "--lj-enter-edge-shift",
      "--lj-enter-dialog-scale",
      "--lj-enter-page-shift",
    ]) {
      expect(tokens, token).toContain(`${token}:`);
    }
    expect(ui).toMatch(/scale\(var\(--lj-enter-layer-scale\)\)/);
    expect(stripComments(read("src/components/ui/LjDialog.vue"))).toMatch(
      /translate\(-50%, -50%\) scale\(var\(--lj-enter-dialog-scale\)\)/
    );
  });

  it("a curva de ida e volta da projeção não foi reajustada", () => {
    // O sorteio usa `--lj-ease` no telão (DrawProjection, DrawWheel).
    expect(stripComments(read("src/assets/styles/tokens.css"))).toMatch(
      /--lj-ease:\s*cubic-bezier\(0\.4, 0, 0\.2, 1\);/
    );
  });
});

describe("a projeção fica fora", () => {
  // O que vai para o telão tem transição escolhida pelo operador (`--fade-ms`,
  // os efeitos de transitions.css). Mola de interface ali mudaria o que a
  // igreja vê sem ninguém ter pedido.
  const PROJECTION_FILES = [
    "src/assets/styles/transitions.css",
    "src/components/OverlayRenderer.vue",
    "src/components/ModuleProjectionLayer.vue",
    "src/components/Slide.vue",
    ...filesIn("src/views", [".vue"]).filter((file) =>
      /(Projection|Obs|Operator|Clock|LibrasOverlay)[A-Za-z]*\.vue$/.test(file)
    ),
  ];

  it("a lista cobre as telas de projeção", () => {
    expect(PROJECTION_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(PROJECTION_FILES)("%s não usa os tokens de mola", (file) => {
    expect(stripComments(read(file))).not.toMatch(
      /--lj-motion-|--lj-ease-spring|--lj-ui-float-enter/
    );
  });
});

describe("camadas modais nascem de onde foi o gesto", () => {
  // Um diálogo que sempre sobe os mesmos pixels, venha de onde vier, tem cara
  // de efeito aplicado por cima. A escala é ancorada no clique que o abriu.
  const layers: Array<[string, RegExp]> = [
    ["src/components/ui/LjDialog.vue", /applyMotionOrigin\(event\.currentTarget/],
    ["src/components/Window.vue", /applyMotionOrigin\(event\.currentTarget\)/],
    ["src/components/BibleSpotlight.vue", /applyMotionOrigin\(\$event\.currentTarget\)/],
    ["src/layout/Alert.vue", /applyMotionOrigin\(overlay\.querySelector\("\.alert"\), "none"\)/],
    ["src/layout/shell/CommandPalette.vue", /applyMotionOrigin\(event\.currentTarget, "none"\)/],
  ];

  it.each(layers)("%s ancora a escala no ponto do toque", (file, call) => {
    expect(read(file)).toMatch(call);
  });

  it.each(layers)("%s não tem deslocamento fixo na entrada", (file) => {
    const css = stripComments(read(file).split("<style")[1] ?? "");
    expect(css).not.toMatch(/--lj-enter-(dialog|edge)-shift/);
    expect(css).not.toMatch(/translateY\(-?\d+px\) scale/);
  });
});

describe("checkbox: a marca é desenhada", () => {
  const ui = stripComments(read("src/assets/styles/ui.css"));

  it("o primitivo risca o traço do ícone, nas duas direções", () => {
    const checkbox = stripComments(read("src/components/ui/LjCheckbox.vue"));
    expect(checkbox).toMatch(
      /stroke-dashoffset: 0;\s*transition: stroke-dashoffset var\(--lj-draw\);/
    );
    expect(checkbox).toMatch(/transition: stroke-dashoffset var\(--lj-exit-panel\);/);
  });

  it("o input nativo tem a mesma caixa e o mesmo tique, só em transform", () => {
    expect(ui).toMatch(/\.lj-native-check,\s*\.opt-checkbox input \{[^}]*appearance: none;/);
    const strokes =
      ui.match(
        /\.lj-native-check(?::checked)?::(?:before|after),[^{]*\{[^}]*transition:[^}]*\}/g
      ) ?? [];
    expect(strokes).toHaveLength(4);
    for (const rule of strokes) {
      expect(rule).toMatch(/transition: transform calc\(var\(--lj-draw(?:-back)?-time\)/);
    }
  });

  it("nenhum checkbox solto fica com a caixa do sistema", () => {
    const loose = filesIn("src", [".vue"]).filter((file) => {
      const source = read(file);
      // LjCheckbox, LjSwitch e FieldBoolean escondem o input e desenham o próprio controle.
      if (/components\/ui\/Lj(Checkbox|Switch)\.vue$|FieldBoolean\.vue$/.test(file)) return false;
      const inputs = source.match(/<input\b[^>]*type="checkbox"[^>]*>/g) ?? [];
      return (
        inputs.some((tag) => !/lj-native-check/.test(tag)) && !/class="opt-checkbox/.test(source)
      );
    });
    expect(loose).toEqual([]);
  });
});

describe("aperto do botão", () => {
  const button = stripComments(read("src/components/ui/LjButton.vue"));

  it("com texto afunda uma distância fixa; só o quadrado de ícone encolhe", () => {
    // Escala é proporcional: num botão esticado pela coluna, 3% são 30px.
    expect(button).toMatch(/\.lj-btn:active\s*\{[^}]*translateY\(var\(--lj-press-shift\)\)/);
    expect(button).toMatch(/\.lj-btn--icon:active\s*\{[^}]*scale\(var\(--lj-press-scale\)\)/);
    expect(button.match(/scale\(/g), "escala em mais de um lugar").toHaveLength(1);
  });

  it("devolve a área de clique que o aperto tira", () => {
    // Sem isto, soltar o ponteiro na borda do botão deslocado entrega o
    // `click` ao elemento pai: o botão afunda e a ação não acontece.
    const guard = button.match(/\.lj-btn:active::after\s*\{([^}]*)\}/);
    expect(guard, "pseudo-elemento que cobre a faixa perdida").not.toBeNull();
    expect(guard![1]).toMatch(/position:\s*absolute/);
    expect(guard![1]).toMatch(/inset:\s*-\d+px/);
  });

  it("não apaga as transições de cor herdadas de .lj-ui-control", () => {
    // `transition` não soma: cada regra que declara `transform` repete as três.
    for (const [, body] of button.matchAll(/\{([^}]*transition:[^}]*)\}/g)) {
      expect(body).toMatch(/background-color var\(--lj-transition-fast\)/);
      expect(body).toMatch(/border-color var\(--lj-transition-fast\)/);
      expect(body).toMatch(/box-shadow var\(--lj-transition-fast\)/);
    }
  });
});

describe("transição de filho não dura mais que a da raiz", () => {
  // O <Transition> do Vue encerra pelo elemento raiz. Se a mola do filho for
  // mais longa que a opacidade do véu, a classe `-active` sai no meio do
  // caminho e a caixa salta para o lugar.
  const tokens = read("src/assets/styles/tokens.css");
  const seconds = (token: string) => {
    const match = tokens.match(new RegExp(`${token}:\\s*([\\d.]+)(m?s)`));
    expect(match, token).not.toBeNull();
    return match![2] === "ms" ? Number(match![1]) / 1000 : Number(match![1]);
  };

  it("--lj-motion-fast cabe dentro de --lj-transition-normal", () => {
    expect(seconds("--lj-motion-fast")).toBeLessThanOrEqual(seconds("--lj-transition-normal"));
  });

  it.each([
    ["src/layout/Alert.vue", ".alert-enter-active", ".alert-enter-active .alert"],
    ["src/layout/shell/CommandPalette.vue", ".cmd-enter-active", ".cmd-enter-active .cmd-palette"],
    ["src/layout/Loading.vue", ".loading-enter-active", ".loading-enter-active .loading"],
  ])("%s: véu em normal, caixa em motion-fast", (file, rootSelector, childSelector) => {
    const css = stripComments(read(file));
    const ruleBody = (selector: string) =>
      css.match(new RegExp(`${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
    expect(ruleBody(rootSelector)).toMatch(/opacity var\(--lj-transition-normal\)/);
    expect(ruleBody(childSelector)).toMatch(/transform var\(--lj-motion-fast\)/);
  });
});

describe("documentação", () => {
  it("o design system descreve os tokens de mola", () => {
    const doc = read("docs/design-system.md");
    for (const token of [
      "--lj-ease-spring",
      "--lj-ease-spring-bounce",
      "--lj-motion-fast",
      "--lj-motion-normal",
      "--lj-motion-bounce",
      "--lj-exit-fast",
      "--lj-exit-panel",
      "--lj-reflow-enter",
      "--lj-reflow-exit",
      "--lj-press-shift",
      "--lj-press-scale",
    ]) {
      expect(doc, token).toContain(token);
    }
  });

  it("o CLAUDE.md aponta a regra para quem for mexer", () => {
    expect(read("CLAUDE.md")).toMatch(/Movimento/);
    expect(read("CLAUDE.md")).toContain("--lj-motion-");
  });
});
