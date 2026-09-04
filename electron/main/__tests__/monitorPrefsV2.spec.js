// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  SCHEMA_VERSION,
  buildConfig,
  needsMigration,
  reconcilePending,
} = require("../migrations/monitorPrefsV2.js");

// O algoritmo de identidade é ESM; a ponte precisa carregá-lo antes do uso.
beforeAll(async () => {
  await require("../monitorIdentityBridge.cjs").init();
});

const LAPTOP = {
  id: 1,
  label: "Built-in Retina Display",
  bounds: { x: 0, y: 0, width: 1728, height: 1117 },
  scaleFactor: 2,
  rotation: 0,
  internal: true,
};
const PROJECTOR = {
  id: 2,
  label: "BenQ MX532",
  bounds: { x: 1728, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
  rotation: 0,
  internal: false,
};

const build = (prefs, connected = [LAPTOP, PROJECTOR], userData = {}) =>
  buildConfig({ prefs, userData, connected });

describe("buildConfig", () => {
  it("converte preferências por feature em papéis com retrato do monitor", () => {
    const { config } = build({ musicas: 2, operador: 1 });
    expect(config.schema_version).toBe(SCHEMA_VERSION);
    expect(config.roles.projection.state).toBe("resolved");
    expect(config.roles.projection.identity.label).toBe("BenQ MX532");
    expect(config.roles.operator.identity.label).toBe("Built-in Retina Display");
    expect(config.roles.stage.state).toBe("none");
  });

  it("marca como pendente o monitor que não está conectado agora", () => {
    // Cenário mais comum do upgrade: o usuário atualiza em casa, projetor
    // desligado. Descartar aqui apagaria a configuração dele.
    const { config, stats } = build({ musicas: 99 }, [LAPTOP]);
    expect(config.roles.projection).toEqual({
      state: "pending",
      identity: null,
      legacy: { kind: "nativeId", id: 99 },
    });
    expect(stats.pending).toBe(1);
  });

  it("resolve os papéis legados primary/secondary", () => {
    const userData = { options: { displays: { monitor_primary: 2, monitor_secondary: 1 } } };
    const { config } = build({ musicas: "primary", retorno: "secondary" }, undefined, userData);
    expect(config.roles.projection.identity.nativeId).toBe(2);
    expect(config.roles.stage.identity.nativeId).toBe(1);
  });

  it('trata 0 e "" como "sem monitor", não como monitor 0', () => {
    const { config } = build({ musicas: 0, retorno: "" });
    expect(config.roles.projection.state).toBe("none");
    expect(config.roles.stage.state).toBe("none");
  });

  it("põe em quarentena as chaves poluídas media:*", () => {
    const { config } = build({ "media:musicas": 2, musicas: 2 });
    expect(config.legacy_unknown).toEqual({ "media:musicas": 2 });
    expect(config.roles.projection.state).toBe("resolved");
  });

  it("migra o namespace shell:* como feature legítima", () => {
    const { config } = build({ "shell:operator": 1 });
    expect(config.roles.operator.identity.nativeId).toBe(1);
  });

  it("preserva escolhas divergentes das features", () => {
    const { config } = build({ musicas: 2, bible: 1 });
    expect(config.roles.projection.identity.nativeId).toBe(2);
    expect(config.legacy_features).toEqual({ bible: 1 });
  });

  it("gera identidade com schema fixo, sem campos faltando", () => {
    // A hidratação do UserData faz deep merge: campo omitido deixaria resíduo.
    const { config } = build({ musicas: 2 });
    const keys = Object.keys(config.roles.projection.identity).sort();
    expect(keys).toEqual(
      ["dip", "index", "internal", "label", "nativeId", "nativeOrigin",
       "primary", "px", "rotation", "scaleFactor", "source"].sort()
    );
  });

  it("não quebra sem preferência nenhuma", () => {
    const { config, stats } = build({});
    expect(stats.none).toBe(3);
    expect(config.legacy_unknown).toEqual({});
  });
});

describe("needsMigration", () => {
  it("roda quando não há configuração v2", () => {
    expect(needsMigration(null, { musicas: 2 })).toBe(true);
    expect(needsMigration({ schema_version: 1 }, { musicas: 2 })).toBe(true);
  });

  it("não repete quando já migrou a mesma fonte", () => {
    const prefs = { musicas: 2 };
    const { config } = build(prefs);
    expect(needsMigration(config, prefs)).toBe(false);
  });

  it("roda de novo se o formato antigo mudou (downgrade e volta)", () => {
    const { config } = build({ musicas: 2 });
    expect(needsMigration(config, { musicas: 3 })).toBe(true);
  });
});

describe("reconcilePending", () => {
  it("promove o papel pendente quando o monitor reaparece", () => {
    const { config } = build({ musicas: 2 }, [LAPTOP]);
    expect(config.roles.projection.state).toBe("pending");

    const { roles, promoted } = reconcilePending(config.roles, [LAPTOP, PROJECTOR]);
    expect(promoted).toEqual(["projection"]);
    expect(roles.projection.state).toBe("resolved");
    expect(roles.projection.identity.label).toBe("BenQ MX532");
    expect(roles.projection.legacy).toBeNull();
  });

  it("mantém pendente enquanto o monitor não volta", () => {
    const { config } = build({ musicas: 2 }, [LAPTOP]);
    const { roles, promoted } = reconcilePending(config.roles, [LAPTOP]);
    expect(promoted).toEqual([]);
    expect(roles.projection.state).toBe("pending");
    expect(roles.projection.legacy.id).toBe(2);
  });

  it("não mexe em papéis já resolvidos", () => {
    const { config } = build({ musicas: 2 });
    const { roles, promoted } = reconcilePending(config.roles, [LAPTOP, PROJECTOR]);
    expect(promoted).toEqual([]);
    expect(roles.projection).toBe(config.roles.projection);
  });
});
