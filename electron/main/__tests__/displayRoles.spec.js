// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { ROLES, deriveRoles, roleOfFeature } from "../displayRoles.mjs";
import { PROJECTION_TYPE } from "@/constants/Projection";

const require = createRequire(import.meta.url);
const { resolveWantedId } = require("../monitorPrefs.js");

const NO_ROLES = { primary: null, secondary: null };
const resolve = (raw) => resolveWantedId(raw, NO_ROLES);

describe("roleOfFeature", () => {
  it.each([
    ["musicas", ROLES.PROJECTION],
    ["bible", ROLES.PROJECTION],
    ["shell:projection", ROLES.PROJECTION],
    ["retorno", ROLES.STAGE],
    ["clock", ROLES.STAGE],
    ["bible_return", ROLES.STAGE],
    ["operador", ROLES.OPERATOR],
    ["shell:operator", ROLES.OPERATOR],
    /*
     * A tela de loading da projeção de Site. Sem papel o `roleOfFeature`
     * devolve null e a janela é recusada fora da tela do operador — o loader
     * simplesmente não apareceria no telão, que é onde ele precisa estar.
     */
    ["site_loader", ROLES.PROJECTION],
    ["site_loader_return", ROLES.STAGE],
    /*
     * O retorno da projeção de Site. Sem papel o `resolveFeature` devolve
     * `unknown-feature` e o `reconcile` OCULTA a janela — o aviso de "Monitor
     * desconectado" aparecia com os três monitores ligados.
     */
    ["site_return", ROLES.STAGE],
  ])('mapeia "%s" para o papel "%s"', (feature, role) => {
    expect(roleOfFeature(feature)).toBe(role);
  });

  /*
   * Trava de cobertura: toda janela que o app sabe abrir precisa de papel.
   *
   * Sem papel, `monitorConfig.resolveFeature` devolve `display: null` e
   * `windowFactory.reconcile` esconde a janela — sem erro nenhum, só o
   * aviso genérico de monitor desconectado. Foi exatamente isso que apagou a
   * tela de retorno da projeção de Site (`site_return` fora da tabela).
   *
   * Falhar aqui vale mais do que descobrir no meio do culto: um
   * `PROJECTION_TYPE` novo esquecido nunca chega ao reconciliador.
   */
  it("todo PROJECTION_TYPE tem papel — uma janela sem papel é ocultada", () => {
    const semPapel = Object.values(PROJECTION_TYPE).filter(
      (feature) => roleOfFeature(feature) == null
    );

    expect(
      semPapel,
      `PROJECTION_TYPE sem entrada em FEATURE_ROLE: ${semPapel.join(", ")}`
    ).toEqual([]);
  });

  it("devolve null para feature desconhecida", () => {
    expect(roleOfFeature("media:musicas")).toBeNull();
    expect(roleOfFeature("qualquer_coisa")).toBeNull();
  });
});

describe("deriveRoles", () => {
  it("usa a feature canônica de cada papel", () => {
    const { roles } = deriveRoles({ musicas: 2, retorno: 3, operador: 1 }, resolve);
    expect(roles).toEqual({ projection: 2, stage: 3, operator: 1 });
  });

  it("deriva o papel por votação quando a canônica não foi configurada", () => {
    // Quem configurou bíblia, sorteio e cronômetro no Monitor 2 quis dizer
    // que o Monitor 2 é o de projeção.
    const { roles } = deriveRoles({ bible: 2, draw: 2, stopwatch: 2 }, resolve);
    expect(roles.projection).toBe(2);
  });

  it("a feature canônica vence a maioria das secundárias", () => {
    const { roles } = deriveRoles({ musicas: 5, bible: 2, draw: 2, counter: 2 }, resolve);
    expect(roles.projection).toBe(5);
  });

  it("preserva as escolhas divergentes em vez de descartá-las", () => {
    // Elas passam a seguir o papel, mas ficam registradas para poderem ser
    // recuperadas se alguém reclamar.
    const { roles, divergent } = deriveRoles({ musicas: 2, bible: 7 }, resolve);
    expect(roles.projection).toBe(2);
    expect(divergent).toEqual({ bible: 7 });
  });

  it("põe chaves fora da allowlist em quarentena, sem interpretar", () => {
    // "media:musicas" foi gravada por engano pelo windowFactory; mapeá-la para
    // "musicas" poderia sobrescrever uma preferência boa.
    const { roles, unknown } = deriveRoles({ "media:musicas": 9, musicas: 2 }, resolve);
    expect(roles.projection).toBe(2);
    expect(unknown).toEqual({ "media:musicas": 9 });
  });

  it("ignora valores que não resolvem", () => {
    const { roles } = deriveRoles({ musicas: 0, retorno: "", operador: null }, resolve);
    expect(roles).toEqual({ projection: null, stage: null, operator: null });
  });

  it("resolve papéis legados primary/secondary", () => {
    const withRoles = (raw) => resolveWantedId(raw, { primary: 4, secondary: 5 });
    const { roles } = deriveRoles({ musicas: "primary", retorno: "secondary" }, withRoles);
    expect(roles).toEqual({ projection: 4, stage: 5, operator: null });
  });

  it("não quebra com preferências vazias", () => {
    expect(deriveRoles({}, resolve).roles).toEqual({
      projection: null,
      stage: null,
      operator: null,
    });
    expect(deriveRoles(null, resolve).roles.projection).toBeNull();
  });
});

describe("famílias dinâmicas de feature", () => {
  it("as janelas de transmissão caem no papel de projeção", () => {
    // Há uma feature por rota de captura ("transmission:/obs/bible"), então não
    // dá para listar cada nome na allowlist.
    expect(roleOfFeature("transmission:/obs")).toBe(ROLES.PROJECTION);
    expect(roleOfFeature("transmission:/obs/bible")).toBe(ROLES.PROJECTION);
  });

  it("continua recusando prefixo desconhecido", () => {
    expect(roleOfFeature("media:musicas")).toBeNull();
  });
});
