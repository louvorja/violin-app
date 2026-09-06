// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ACCEPT_THRESHOLD,
  identityFromDisplay,
  matchIdentities,
  matchIdentity,
  scoreIdentity,
  vetoReason,
  withUniqueIds,
} from "../monitorIdentity.mjs";

/** Projetor externo 1080p — o monitor de projeção típico. */
function projector(overrides = {}) {
  return identityFromDisplay(
    {
      id: 2528732444,
      label: "BenQ MX532",
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      rotation: 0,
      internal: false,
      ...overrides,
    },
    1
  );
}

/** Painel interno de notebook. */
function laptopPanel(overrides = {}) {
  return identityFromDisplay(
    {
      id: 69733382,
      label: "Built-in Retina Display",
      bounds: { x: 0, y: 0, width: 1728, height: 1117 },
      scaleFactor: 2,
      rotation: 0,
      internal: true,
      ...overrides,
    },
    0
  );
}

describe("identityFromDisplay", () => {
  it("guarda a resolução física, não a lógica", () => {
    // O scaleFactor muda quando o usuário mexe no zoom do sistema; a resolução
    // física do aparelho, não.
    expect(laptopPanel().px).toEqual({ w: 3456, h: 2234 });
    expect(laptopPanel().dip).toEqual({ w: 1728, h: 1117 });
  });

  it("preenche todos os campos mesmo com um display incompleto", () => {
    // Schema fixo: a hidratação do UserData faz deep merge e não remove chaves
    // ausentes, então um campo omitido deixaria resíduo da config anterior.
    const identity = identityFromDisplay({}, 0);
    expect(Object.keys(identity).sort()).toEqual(
      [
        "dip", "index", "internal", "label", "nativeId", "nativeOrigin",
        "primary", "px", "rotation", "scaleFactor", "source",
      ].sort()
    );
  });
});

describe("cenários de reconciliação", () => {
  it("troca de porta HDMI: reconhece o mesmo monitor com id novo", () => {
    const saved = projector();
    const connected = projector({ id: 111222333 });
    const { status, score } = matchIdentity(saved, [connected]);
    expect(status).toBe("resolved");
    expect(score).toBeGreaterThan(0.9);
  });

  it("rearranjo de posição no SO: reconhece apesar de origem e índice novos", () => {
    const saved = projector();
    const connected = identityFromDisplay(
      { ...{ id: 2528732444, label: "BenQ MX532", scaleFactor: 1, rotation: 0, internal: false },
        bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
      0
    );
    const { status, score } = matchIdentity(saved, [connected]);
    expect(status).toBe("resolved");
    expect(score).toBeGreaterThan(0.85);
  });

  it("monitor trocado por outro modelo: recusa em vez de chutar", () => {
    const saved = projector();
    const connected = identityFromDisplay(
      { id: 55, label: "Epson PowerLite", bounds: { x: 1920, y: 0, width: 1280, height: 800 },
        scaleFactor: 1, rotation: 0, internal: false },
      1
    );
    expect(vetoReason(saved, connected)).toBe("label-and-size-mismatch");
    expect(matchIdentity(saved, [connected]).status).toBe("unmatched");
  });

  it("projetor renegociando 1080p→720p: reconhece pelo formato da tela", () => {
    const saved = projector();
    const connected = projector({ bounds: { x: 1920, y: 0, width: 1280, height: 720 } });
    const { status } = matchIdentity(saved, [connected]);
    expect(status).toBe("resolved");
  });

  it("notebook fora do dock: não cai no painel interno", () => {
    // O pior modo de falha do sistema: a letra da música na tela do operador.
    const saved = projector();
    expect(vetoReason(saved, laptopPanel())).toBe("internal-mismatch");
    expect(matchIdentity(saved, [laptopPanel()]).status).toBe("unmatched");
  });

  it("só um monitor conectado: não sequestra a tela do operador", () => {
    const saved = projector();
    expect(matchIdentity(saved, [laptopPanel()]).status).toBe("unmatched");
  });

  it("dois monitores idênticos: cada preferência fica com o seu", () => {
    // Duas saídas do mesmo modelo é comum em igreja. Resolver isoladamente
    // faria as duas preferências colapsarem no mesmo monitor.
    const savedA = projector({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    const savedB = projector({ id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } });
    const connectedA = projector({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    const connectedB = projector({ id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } });

    const result = matchIdentities(
      { projection: savedA, stage: savedB },
      [connectedA, connectedB]
    );
    expect(result.projection.status).toBe("resolved");
    expect(result.stage.status).toBe("resolved");
    expect(result.projection.candidate).not.toBe(result.stage.candidate);
  });

  it("monitores gêmeos e indistinguíveis: marca ambíguo em vez de adivinhar", () => {
    const twin = (index) =>
      identityFromDisplay(
        { label: "BenQ MX532", bounds: { width: 1920, height: 1080 },
          scaleFactor: 1, rotation: 0, internal: false },
        index
      );
    const saved = { ...twin(0), index: null, nativeId: null, nativeOrigin: null };
    const result = matchIdentity(saved, [twin(0), twin(1)]);
    expect(result.status).toBe("ambiguous");
    expect(result.candidate).toBeNull();
  });
});

describe("Linux/X11 — label indisponível", () => {
  const blind = (overrides = {}, index = 1) =>
    identityFromDisplay(
      { id: 3, label: "", bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1, rotation: 0, internal: false, ...overrides },
      index
    );

  it("sem label, a geometria carrega a identificação", () => {
    const { score } = scoreIdentity(blind(), blind());
    expect(score).toBe(1);
  });

  it("sem label e com rearranjo, ainda reconhece", () => {
    const saved = blind();
    const connected = blind({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, 0);
    const { score } = scoreIdentity(saved, connected);
    expect(score).toBeGreaterThan(ACCEPT_THRESHOLD);
  });
});

describe("fingerprints de plataformas diferentes", () => {
  it("nunca compara identidade do web com a do Electron", () => {
    // As unidades de px e nativeOrigin não são equivalentes entre as duas.
    const saved = { ...projector(), source: "web" };
    expect(vetoReason(saved, projector())).toBe("source-mismatch");
  });
});

describe("matchIdentities", () => {
  it("devolve unmatched para todas quando não há monitor conectado", () => {
    const result = matchIdentities({ projection: projector() }, []);
    expect(result.projection).toEqual({ status: "unmatched", candidate: null, score: 0 });
  });

  it("não quebra sem identidades salvas", () => {
    expect(matchIdentities({}, [projector()])).toEqual({});
  });
});

/**
 * Medido numa dupla de monitores idênticos: os dois voltaram do Electron com o
 * mesmo id, 20570490453689664 — valor acima de 2^53, onde o `double` do
 * JavaScript só representa múltiplos de 4 e engole o índice da saída, que é o
 * que o Chromium usa para separá-los.
 */
describe("withUniqueIds", () => {
  const GEMEO = 20570490453689664;
  const esquerda = {
    id: GEMEO,
    label: "QEMU Monitor",
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    internal: false,
  };
  const direita = {
    ...esquerda,
    bounds: { x: 1280, y: 0, width: 1280, height: 720 },
  };

  it("separa dois monitores que o sistema entrega com o mesmo id", () => {
    const ids = withUniqueIds([esquerda, direita], esquerda).map((d) => d.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("acha o monitor certo pelo id que ele mesmo publicou", () => {
    const lista = withUniqueIds([esquerda, direita], esquerda);
    const achado = lista.find((d) => d.id === lista[1].id);
    expect(achado.bounds).toEqual(direita.bounds);
  });

  it("marca um único principal", () => {
    const lista = withUniqueIds([esquerda, direita], direita);
    expect(lista.filter((d) => d.primary)).toHaveLength(1);
    expect(lista.find((d) => d.primary).bounds).toEqual(direita.bounds);
  });

  it("preserva o id do sistema quando não há repetição", () => {
    const outro = { ...direita, id: 999 };
    expect(withUniqueIds([esquerda, outro], esquerda).map((d) => d.id)).toEqual([
      GEMEO,
      999,
    ]);
  });

  it("mantém o id estável entre chamadas, que é o que a preferência grava", () => {
    const a = withUniqueIds([esquerda, direita], esquerda).map((d) => d.id);
    const b = withUniqueIds([esquerda, direita], esquerda).map((d) => d.id);
    expect(a).toEqual(b);
  });
});
