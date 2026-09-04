// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const monitorConfig = require("../monitorConfig.js");
const { STATUS } = monitorConfig;

// O algoritmo de identidade é ESM; a ponte precisa carregá-lo antes do uso.
beforeAll(async () => {
  await require("../monitorIdentityBridge.cjs").init();
});

const LAPTOP = {
  id: 1, label: "Built-in Retina Display", primary: true, internal: true,
  bounds: { x: 0, y: 0, width: 1728, height: 1117 }, scaleFactor: 2, rotation: 0,
};
const PROJECTOR = {
  id: 2, label: "BenQ MX532", primary: false, internal: false,
  bounds: { x: 1728, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0,
};
const TV = {
  id: 3, label: "Samsung TV", primary: false, internal: false,
  bounds: { x: 3648, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0,
};

const BOTH = [LAPTOP, PROJECTOR];
let userData;

beforeEach(() => {
  userData = {};
});

/** Migra `prefs` com os monitores informados e devolve o userData resultante. */
function migrate(prefs, connected = BOTH) {
  monitorConfig.migrateIfNeeded({ userData, prefs, connected });
  return userData;
}

describe("migrateIfNeeded", () => {
  it("cria a configuração v2 a partir do formato antigo", () => {
    const { changed, stats } = monitorConfig.migrateIfNeeded({
      userData, prefs: { musicas: 2 }, connected: BOTH,
    });
    expect(changed).toBe(true);
    expect(stats.resolved).toBe(1);
    expect(monitorConfig.getConfig(userData).roles.projection.state).toBe("resolved");
  });

  it("é idempotente: não reescreve na segunda chamada", () => {
    const prefs = { musicas: 2 };
    monitorConfig.migrateIfNeeded({ userData, prefs, connected: BOTH });
    const second = monitorConfig.migrateIfNeeded({ userData, prefs, connected: BOTH });
    expect(second.changed).toBe(false);
  });

  it("preserva as demais opções do usuário", () => {
    userData = { options: { theme: "dark", displays: { monitor_primary: 2 } } };
    monitorConfig.migrateIfNeeded({ userData, prefs: { musicas: 2 }, connected: BOTH });
    expect(userData.options.theme).toBe("dark");
    expect(userData.options.displays.monitor_primary).toBe(2);
  });

  it("fail-open: erro na migração não derruba o boot", () => {
    const circular = {};
    circular.self = circular;
    const result = monitorConfig.migrateIfNeeded({
      userData, prefs: circular, connected: BOTH,
    });
    expect(result.changed).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe("resolveRole", () => {
  it("encontra o monitor salvo", () => {
    migrate({ musicas: 2 });
    const result = monitorConfig.resolveRole({ userData, role: "projection", connected: BOTH });
    expect(result.status).toBe(STATUS.RESOLVED);
    expect(result.display).toBe(PROJECTOR);
  });

  it("reconhece o monitor mesmo com id novo (troca de porta)", () => {
    migrate({ musicas: 2 });
    const reconnected = { ...PROJECTOR, id: 987654 };
    const result = monitorConfig.resolveRole({
      userData, role: "projection", connected: [LAPTOP, reconnected],
    });
    expect(result.status).toBe(STATUS.RESOLVED);
    expect(result.display).toBe(reconnected);
  });

  it("não devolve a tela do operador quando o projetor sumiu", () => {
    // O modo de falha que motivou todo o refactor.
    migrate({ musicas: 2 });
    const result = monitorConfig.resolveRole({
      userData, role: "projection", connected: [LAPTOP],
    });
    expect(result.display).toBeNull();
    expect(result.status).not.toBe(STATUS.RESOLVED);
  });

  it("distingue monitor que sumiu de papel nunca configurado", () => {
    migrate({ musicas: 2 });
    const result = monitorConfig.resolveRole({
      userData, role: "projection", connected: [LAPTOP],
    });
    expect(result.status).toBe(STATUS.PENDING);
    expect(result.reason).toBe("monitor-absent");
  });

  it("deduz o único monitor externo quando a preferência está pendente", () => {
    migrate({ musicas: 99 }, [LAPTOP]);
    const result = monitorConfig.resolveRole({
      userData, role: "projection", connected: BOTH,
    });
    expect(result.status).toBe(STATUS.INFERRED);
    expect(result.display).toBe(PROJECTOR);
    expect(result.reason).toBe("sole-external");
  });

  it("não deduz quando há mais de um monitor externo", () => {
    migrate({ musicas: 99 }, [LAPTOP]);
    const result = monitorConfig.resolveRole({
      userData, role: "projection", connected: [LAPTOP, PROJECTOR, TV],
    });
    expect(result.status).toBe(STATUS.PENDING);
    expect(result.display).toBeNull();
  });

  it("nunca deduz monitor para o papel do operador", () => {
    migrate({ operador: 99 }, [LAPTOP]);
    const result = monitorConfig.resolveRole({
      userData, role: "operator", connected: BOTH,
    });
    expect(result.display).toBeNull();
  });

  it("devolve none quando o papel nunca foi configurado", () => {
    migrate({ musicas: 2 });
    const result = monitorConfig.resolveRole({ userData, role: "stage", connected: BOTH });
    expect(result.status).toBe(STATUS.NONE);
  });

  it("o kill switch volta ao resolvedor antigo", () => {
    migrate({ musicas: 2 });
    userData.options.displays.use_legacy_resolver = true;
    const result = monitorConfig.resolveRole({ userData, role: "projection", connected: BOTH });
    expect(result.status).toBe(STATUS.NONE);
    expect(result.reason).toBe("no-v2-config");
  });
});

describe("resolveFeature", () => {
  it("resolve pela feature, via papel", () => {
    migrate({ musicas: 2 });
    const result = monitorConfig.resolveFeature({ userData, feature: "bible", connected: BOTH });
    expect(result.role).toBe("projection");
    expect(result.display).toBe(PROJECTOR);
  });

  it("recusa feature desconhecida", () => {
    migrate({ musicas: 2 });
    const result = monitorConfig.resolveFeature({
      userData, feature: "media:musicas", connected: BOTH,
    });
    expect(result.reason).toBe("unknown-feature");
    expect(result.display).toBeNull();
  });
});

describe("reconcile", () => {
  it("promove pendências quando o monitor volta", () => {
    migrate({ musicas: 2 }, [LAPTOP]);
    expect(monitorConfig.getConfig(userData).roles.projection.state).toBe("pending");

    const { changed, promoted } = monitorConfig.reconcile({ userData, connected: BOTH });
    expect(changed).toBe(true);
    expect(promoted).toEqual(["projection"]);
    expect(monitorConfig.getConfig(userData).roles.projection.state).toBe("resolved");
  });

  it("não faz nada sem configuração v2", () => {
    expect(monitorConfig.reconcile({ userData: {}, connected: BOTH })).toEqual({
      changed: false, promoted: [],
    });
  });
});

describe("setRoleDisplay", () => {
  it("aponta o papel para um monitor", () => {
    migrate({});
    monitorConfig.setRoleDisplay({
      userData, role: "stage", display: PROJECTOR, connected: BOTH,
    });
    const result = monitorConfig.resolveRole({ userData, role: "stage", connected: BOTH });
    expect(result.display).toBe(PROJECTOR);
  });

  it("limpa o papel quando o monitor é null", () => {
    migrate({ musicas: 2 });
    monitorConfig.setRoleDisplay({
      userData, role: "projection", display: null, connected: BOTH,
    });
    expect(monitorConfig.resolveRole({ userData, role: "projection", connected: BOTH }).status)
      .toBe(STATUS.NONE);
  });
});

describe("papel por feature", () => {
  it("usa o padrão do módulo quando o usuário não escolheu", () => {
    migrate({ musicas: 2 });
    expect(monitorConfig.featureRole(userData, "bible")).toBe("projection");
    expect(monitorConfig.featureRole(userData, "clock")).toBe("stage");
  });

  it("a escolha do usuário vence o padrão", () => {
    migrate({ musicas: 2 });
    monitorConfig.setFeatureRole({ userData, feature: "bible", role: "stage" });
    expect(monitorConfig.featureRole(userData, "bible")).toBe("stage");
  });

  it('"mesma janela" desliga o papel da feature', () => {
    migrate({ musicas: 2 });
    monitorConfig.setFeatureRole({ userData, feature: "bible", role: null });
    expect(monitorConfig.featureRole(userData, "bible")).toBeNull();

    const result = monitorConfig.resolveFeature({ userData, feature: "bible", connected: BOTH });
    expect(result.display).toBeNull();
    expect(result.reason).toBe("no-role");
  });

  it("recusa papel inexistente", () => {
    migrate({ musicas: 2 });
    expect(monitorConfig.setFeatureRole({ userData, feature: "bible", role: "xpto" })).toBe(false);
    expect(monitorConfig.featureRole(userData, "bible")).toBe("projection");
  });
});

describe("rolesSummary", () => {
  it("descreve o estado de cada papel para a UI", () => {
    migrate({ musicas: 2 });
    const summary = monitorConfig.rolesSummary({ userData, connected: BOTH });
    expect(summary).toEqual([
      { role: "projection", status: STATUS.RESOLVED, reason: null, displayId: 2 },
      { role: "stage", status: STATUS.NONE, reason: null, displayId: null },
      { role: "operator", status: STATUS.NONE, reason: null, displayId: null },
    ]);
  });

  it("sinaliza monitor ausente para a UI avisar", () => {
    migrate({ musicas: 2 });
    const summary = monitorConfig.rolesSummary({ userData, connected: [LAPTOP] });
    expect(summary[0]).toEqual({
      role: "projection", status: STATUS.PENDING, reason: "monitor-absent", displayId: null,
    });
  });
});
