// @vitest-environment node
/**
 * `addPending` marca o device como PENDENTE — é o que a tela de aprovação lê.
 *
 * Sem este estado, pendência era inferida de "lista de permissões vazia", e
 * aí salvar um dispositivo sem nenhuma permissão o devolvia para a fila de
 * aprovação. O detalhe que não pode faltar: reescanear o QR de um aparelho já
 * aprovado NÃO pode tirá-lo da lista de autorizados.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const userStore = require("../userStore.js");
const devices = require("../devices.js");

beforeAll(() => {
  vi.spyOn(userStore, "read").mockReturnValue(null);
  vi.spyOn(userStore, "write").mockResolvedValue(undefined);
});

afterAll(() => vi.restoreAllMocks());

function registrar(info = {}) {
  return devices.addPending({
    token: "tok-1",
    name: "iPhone",
    model: "iPhone 15",
    platform: "ios",
    fingerprint: "fp-1",
    ...info,
  });
}

describe("addPending — o estado pendente é explícito", () => {
  it("um device novo nasce pending, com o token e a lista vazia", () => {
    devices.save([]);
    const d = registrar();

    expect(d.status).toBe("pending");
    expect(d.permissions).toEqual([]);
    expect(d.token).toBe("tok-1");
  });

  it("reescanear o QR de um device já aprovado não o vira pendente de novo", () => {
    devices.save([]);
    registrar();
    /* O operador aprova com permissões e o aparelho escaneia o QR outra vez. */
    devices.save([
      {
        id: "fp-1",
        token: "tok-1",
        name: "iPhone",
        platform: "ios",
        registeredAt: "2026-01-01T00:00:00.000Z",
        permissions: ["music"],
        status: "approved",
      },
    ]);

    const d = registrar({ token: "tok-2", name: "iPhone do Operator" });

    /* Token e nome atualizados; estado e permissões intactos. */
    expect(d.token).toBe("tok-2");
    expect(d.name).toBe("iPhone do Operator");
    expect(d.status).toBe("approved");
    expect(d.permissions).toEqual(["music"]);
  });

  it("save() preserva o campo status ao sincronizar do renderer", () => {
    devices.save([]);
    registrar();

    const lista = devices.list().map((d) => ({ ...d }));
    devices.save(lista);

    expect(devices.list()[0].status).toBe("pending");
  });
});
