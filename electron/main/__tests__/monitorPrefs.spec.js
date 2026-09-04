// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { resolveWantedId, rolesFromUserData } = require("../monitorPrefs.js");

const NO_ROLES = { primary: null, secondary: null };

describe("resolveWantedId", () => {
  it("aceita id numérico", () => {
    expect(resolveWantedId(2, NO_ROLES)).toBe(2);
  });

  it("aceita id numérico gravado como string", () => {
    expect(resolveWantedId("2", NO_ROLES)).toBe(2);
  });

  it.each([[0], [-1], [""], ["   "], [null], [undefined], [{}], [[]], ["abc"]])(
    'trata %p como "sem preferência"',
    (value) => {
      expect(resolveWantedId(value, NO_ROLES)).toBeNull();
    }
  );

  it('resolve o papel "primary" pelo monitor atribuído', () => {
    // Regressão: antes a string era comparada com o id numérico e nunca casava,
    // então toda configuração feita pelo MonitorSelect era ignorada.
    expect(resolveWantedId("primary", { primary: 7, secondary: 9 })).toBe(7);
  });

  it('resolve o papel "secondary" pelo monitor atribuído', () => {
    expect(resolveWantedId("secondary", { primary: 7, secondary: 9 })).toBe(9);
  });

  it.each([["primary"], ["secondary"]])(
    'retorna null quando o papel "%s" não tem monitor atribuído',
    (role) => {
      expect(resolveWantedId(role, NO_ROLES)).toBeNull();
    }
  );

  it("ignora espaços em volta do valor", () => {
    expect(resolveWantedId("  secondary  ", { primary: null, secondary: 3 })).toBe(3);
  });

  it("não quebra quando os papéis não são informados", () => {
    expect(resolveWantedId("primary", undefined)).toBeNull();
    expect(resolveWantedId(4, undefined)).toBe(4);
  });
});

describe("rolesFromUserData", () => {
  it("extrai os monitores dos papéis", () => {
    const userData = { options: { displays: { monitor_primary: 1, monitor_secondary: 2 } } };
    expect(rolesFromUserData(userData)).toEqual({ primary: 1, secondary: 2 });
  });

  it.each([[undefined], [null], [{}], [{ options: {} }], [{ options: { displays: {} } }]])(
    "devolve papéis vazios para %p",
    (userData) => {
      expect(rolesFromUserData(userData)).toEqual({ primary: null, secondary: null });
    }
  );

  it('descarta 0, que a UI grava como "nenhum"', () => {
    const userData = { options: { displays: { monitor_primary: 0, monitor_secondary: 0 } } };
    expect(rolesFromUserData(userData)).toEqual({ primary: null, secondary: null });
  });
});
