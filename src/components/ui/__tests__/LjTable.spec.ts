import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import LjTable from "../LjTable.vue";
import { mountUi } from "./mountUi";

const CORPO = "<tbody><tr><td>Castelo Forte</td></tr></tbody>";

const fonte = readFileSync("src/components/ui/LjTable.vue", "utf8");
const estilo = fonte.slice(fonte.indexOf("<style"), fonte.indexOf("</style>"));

/** Linhas de seletor do bloco de estilo (as que abrem ou continuam uma regra). */
function seletores(): string[] {
  return estilo
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha.endsWith("{") || linha.endsWith(","))
    .map((linha) => linha.replace(/\s*[{,]$/, ""))
    .filter((linha) => linha.length > 0 && !linha.startsWith("@") && !linha.startsWith("/*"));
}

function corpoDaRegra(seletor: RegExp): string {
  const m = estilo.match(new RegExp(`${seletor.source}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`regra ausente no estilo: ${seletor}`);
  return m[1];
}

describe("LjTable", () => {
  it("entrega o conteúdo do slot dentro de uma <table> de verdade", () => {
    const w = mountUi(LjTable, {
      slots: {
        default: `<thead><tr><th>Música</th></tr></thead>${CORPO}`,
      },
    });

    const tabela = w.get("table.lj-table__table");
    expect(tabela.get("thead th").text()).toBe("Música");
    expect(tabela.get("tbody td").text()).toBe("Castelo Forte");
  });

  it("o contêiner é uma div em volta da tabela — a rolagem é dele, não da página", () => {
    const w = mountUi(LjTable, { slots: { default: CORPO } });

    expect(w.element.tagName).toBe("DIV");
    expect(w.classes()).toContain("lj-table");
    expect(w.find(".lj-table > table").exists()).toBe(true);
  });

  it("nasce compacta — a densidade da shell é a do Delphi", () => {
    const w = mountUi(LjTable, { slots: { default: CORPO } });

    expect(w.classes()).toContain("lj-table--compact");
    expect(w.classes()).not.toContain("lj-table--comfortable");
  });

  it("troca de densidade quando pedem", () => {
    const w = mountUi(LjTable, { props: { density: "comfortable" }, slots: { default: CORPO } });

    expect(w.classes()).toContain("lj-table--comfortable");
    expect(w.classes()).not.toContain("lj-table--compact");
  });

  it("listras, realce de linha e cabeçalho fixo são opcionais e independentes", () => {
    const nu = mountUi(LjTable, { slots: { default: CORPO } });
    expect(nu.classes()).not.toContain("lj-table--striped");
    expect(nu.classes()).not.toContain("lj-table--hover");
    expect(nu.classes()).not.toContain("lj-table--sticky");

    const so_listra = mountUi(LjTable, { props: { striped: true }, slots: { default: CORPO } });
    expect(so_listra.classes()).toContain("lj-table--striped");
    expect(so_listra.classes()).not.toContain("lj-table--hover");
    expect(so_listra.classes()).not.toContain("lj-table--sticky");

    const tudo = mountUi(LjTable, {
      props: { striped: true, hover: true, sticky: true },
      slots: { default: CORPO },
    });
    expect(tudo.classes()).toEqual(
      expect.arrayContaining([
        "lj-table--striped",
        "lj-table--hover",
        "lj-table--sticky",
        "lj-table--compact",
      ])
    );
  });

  it("maxHeight vira altura limite do contêiner — é o que dá rolagem vertical própria", () => {
    const sem = mountUi(LjTable, { slots: { default: CORPO } });
    expect(sem.attributes("style") || "").not.toContain("max-height");

    const com = mountUi(LjTable, { props: { maxHeight: "240px" }, slots: { default: CORPO } });
    expect(com.attributes("style")).toContain("max-height: 240px");
  });

  it("classe e estilo de quem usa pousam no contêiner, não somem", () => {
    const w = mountUi(LjTable, {
      props: { maxHeight: "100%" },
      attrs: { class: "lj-u-h-full", style: "min-width: 320px" },
      slots: { default: CORPO },
    });

    expect(w.classes()).toContain("lj-u-h-full");
    expect(w.classes()).toContain("lj-table");
    expect(w.attributes("style")).toContain("max-height: 100%");
    expect(w.attributes("style")).toContain("min-width: 320px");
  });

  it("o contêiner tem rolagem própria — tabela larga não empurra a página de lado", () => {
    const raiz = corpoDaRegra(/\.lj-table/);

    expect(raiz).toMatch(/overflow(-x)?:\s*(auto|scroll)/);
  });

  /**
   * Conteúdo de slot é compilado no escopo de QUEM CHAMA. Um seletor de célula
   * sem :deep() sai carimbado com o atributo deste componente, não casa com
   * nada e o estilo inteiro some sem erro no console.
   */
  it("todo seletor de célula passa por :deep()", () => {
    const elementos = /\b(thead|tbody|tfoot|tr|th|td)\b/;
    const soltos = seletores().filter((sel) => elementos.test(sel.replace(/:deep\([^)]*\)/g, " ")));

    expect(soltos).toEqual([]);
    expect(seletores().filter((sel) => sel.includes(":deep(")).length).toBeGreaterThan(0);
  });

  it("o cabeçalho fixo gruda no topo só na variante sticky", () => {
    const sticky = corpoDaRegra(/\.lj-table--sticky :deep\(thead th\)/);
    expect(sticky).toMatch(/position:\s*sticky/);
    expect(sticky).toMatch(/top:\s*0/);

    // Sem a variante, o cabeçalho é cabeçalho comum: nenhuma outra regra o gruda.
    const base = corpoDaRegra(/\.lj-table :deep\(thead th\)/);
    expect(base).not.toMatch(/position:\s*sticky/);
  });

  it("não inventa data-grid: sem ordenação, paginação ou filtro na API", () => {
    const w = mountUi(LjTable, { slots: { default: CORPO } });

    expect(Object.keys(w.props())).toEqual(
      expect.arrayContaining(["density", "striped", "hover", "sticky", "maxHeight"])
    );
    expect(Object.keys(w.props())).toHaveLength(5);
  });
});

describe("LjTable — área que rola alcança o teclado", () => {
  it("com altura máxima o contêiner entra na ordem de tabulação", () => {
    const w = mountUi(LjTable, { props: { maxHeight: "320px" }, slots: { default: "<tbody />" } });
    expect(w.get(".lj-table").attributes("tabindex")).toBe("0");
    expect(w.get(".lj-table").attributes("role")).toBe("region");
  });

  it("sem altura máxima não cria parada de tabulação", () => {
    const w = mountUi(LjTable, { slots: { default: "<tbody />" } });
    expect(w.get(".lj-table").attributes("tabindex")).toBeUndefined();
  });
});
