import { describe, expect, it } from "vitest";
import {
  ACCEPT_THRESHOLD,
  identityFromDisplay,
  matchIdentity,
  type MonitorIdentity,
} from "@/helpers/MonitorIdentity";

/**
 * A lógica em si é testada em electron/main/__tests__/monitorIdentity.spec.js.
 * Aqui garantimos só que a ponte CJS→ESM continua de pé: o main process e o
 * renderer precisam compartilhar a MESMA implementação, senão o desktop e o
 * web divergem em silêncio.
 */
describe("ponte MonitorIdentity (renderer)", () => {
  const display = {
    id: 1,
    label: "BenQ MX532",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
  };

  it("expõe a implementação compartilhada", () => {
    expect(typeof ACCEPT_THRESHOLD).toBe("number");
    const identity: MonitorIdentity = identityFromDisplay(display, 0);
    expect(identity.source).toBe("electron");
    expect(identity.px).toEqual({ w: 1920, h: 1080 });
  });

  it("reconcilia pelo mesmo algoritmo do main process", () => {
    const identity = identityFromDisplay(display, 0);
    expect(matchIdentity(identity, [identity]).status).toBe("resolved");
  });
});
