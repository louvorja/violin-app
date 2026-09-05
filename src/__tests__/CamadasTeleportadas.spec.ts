import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Toda camada que o app teleporta para o `<body>` e que recebe clique precisa
 * declarar `pointer-events: auto`.
 *
 * O motivo é a Reka: quando um diálogo modal abre — a janela de módulo, um
 * `LjDialog`, um `LjDrawer` temporário — ela carimba `pointer-events: none` no
 * `<body>` para tornar inerte tudo que está fora dele. Um painel nosso
 * teleportado para o `<body>` está, por definição, fora. Ele continua visível,
 * continua acima na pilha de camadas, e simplesmente não responde a clique.
 *
 * Foi assim que o alerta "Deseja fechar este slide?" ficou preso na tela com a
 * janela do Mídia aberta: o operador via a pergunta, clicava, e nada acontecia.
 * Nada no console. Só a suspeita de que o app tinha travado.
 *
 * O teste é de fonte, e não de comportamento, porque o jsdom não resolve
 * herança de `pointer-events` nem calcula layout — a falha só existe no
 * navegador de verdade.
 */
const CAMADAS: { arquivo: string; seletor: string; oQueE: string }[] = [
  { arquivo: "src/layout/Alert.vue", seletor: ".alert-overlay", oQueE: "alerta e confirmação" },
  {
    arquivo: "src/layout/shell/CommandPalette.vue",
    seletor: ".cmd-overlay",
    oQueE: "paleta de comandos",
  },
  { arquivo: "src/layout/shell/AppMenu.vue", seletor: ".app-menu-overlay", oQueE: "menu do app" },
  { arquivo: "src/components/ui/LjToast.vue", seletor: ".lj-toast", oQueE: "aviso com ação" },
  {
    arquivo: "src/modules/bible_search/components/BookPicker.vue",
    seletor: ".book-picker-popover",
    oQueE: "seletor de livro",
  },
  {
    arquivo: "src/modules/bible_search/components/Index.vue",
    seletor: ".bs-history",
    oQueE: "histórico de busca",
  },
];

function blocoDe(css: string, seletor: string): string | null {
  const inicio = css.search(new RegExp(`^${seletor.replace(".", "\\.")} \\{`, "m"));
  if (inicio === -1) return null;
  const fim = css.indexOf("}", inicio);
  return fim === -1 ? null : css.slice(inicio, fim);
}

describe("camadas teleportadas continuam clicáveis sobre um modal", () => {
  it.each(CAMADAS)("$oQueE ($seletor) retoma o ponteiro", ({ arquivo, seletor }) => {
    const bloco = blocoDe(readFileSync(arquivo, "utf8"), seletor);
    expect(bloco, `${arquivo}: bloco ${seletor} não encontrado`).not.toBeNull();
    expect(bloco).toMatch(/pointer-events:\s*auto/);
  });

  it("a janela não se minimiza quando o clique é no alerta", () => {
    // A Reka considera "fora" tudo que não é descendente do conteúdo do
    // diálogo, e o alerta é teleportado — sem esta guarda, responder à
    // confirmação minimizava a própria janela que a pergunta era sobre.
    const src = readFileSync("src/components/Window.vue", "utf8");
    const fn = src.slice(src.indexOf("function onPointerDownOutside"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toContain(".alert-overlay");
  });
});
