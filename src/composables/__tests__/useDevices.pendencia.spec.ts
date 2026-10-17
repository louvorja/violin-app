/**
 * Pendência de dispositivo é ESTADO, não "lista de permissões vazia".
 *
 * A inferência antiga (`sem permissões` = `pending`) quebrava o fluxo normal:
 * salvar um dispositivo sem NENHUMA permissão o devolvia para a tela de
 * aprovação, porque o `devices:changed` do save reavaliava a lista inteira —
 * e voltava de novo a cada reinício do app, porque a checagem também roda no
 * boot.
 *
 * Sem permissão significa INERTE (o servidor HTTP recusa o acesso), que é outra
 * coisa. O registro anterior ao campo `status` continua sendo inferido pela
 * lista vazia, para o aparelho que chegou antes da mudança não ficar esperando
 * aprovação que ninguém veria.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { Device } from "@/types/Device";

/** Listeners que o composable registrou em `Platform.devices`. */
const ouvintes = {
  changed: [] as Array<(list: Device[]) => void>,
  pending: [] as Array<(d: Device) => void>,
};
const salvos: Device[][] = [];
/** O que o IndexedDB devolve no `syncFromIdb`. */
let rowIdb: { id: string; devices: Device[] } | null = null;

vi.mock("@/helpers/Platform", () => ({
  default: {
    devices: {
      list: async () => [],
      save: async (lista: Device[]) => {
        salvos.push(lista);
      },
      /* Singleton: o composable registra uma vez só, então o mock também — os
         mesmos callbacks servem a todos os "restarts" deste spec. */
      onChanged: (cb: (list: Device[]) => void) => {
        if (!ouvintes.changed.length) ouvintes.changed.push(cb);
        return () => {};
      },
      onPending: (cb: (d: Device) => void) => {
        if (!ouvintes.pending.length) ouvintes.pending.push(cb);
        return () => {};
      },
    },
  },
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    get: async (_table: string, _key: string) => rowIdb,
    put: async () => {},
  },
}));

const { useDevices } = await import("@/composables/useDevices");

function device(extra: Partial<Device> = {}): Device {
  return {
    id: "d1",
    token: "t1",
    name: "iPhone",
    platform: "ios",
    registeredAt: "2026-01-01T00:00:00.000Z",
    permissions: ["music"],
    status: "approved",
    ...extra,
  };
}

/** Instala um device na lista persistida e "reinicia" o composable. */
async function bootCom(lista: Device[]) {
  rowIdb = { id: "authorized_devices", devices: lista };
  salvos.length = 0;
  const d = useDevices();
  await d.loadDevices();
  return d;
}

beforeEach(() => {
  rowIdb = null;
  salvos.length = 0;
});

describe("pendência é estado, não lista vazia", () => {
  it("salvar um dispositivo sem nenhuma permissão não o vira pendente", async () => {
    /* O bug reportado: o `devices:changed` do save reavaliava a lista e achava o
       device recém-editado sem permissões, abrindo Aprovar/Rejeitar. */
    const d = await bootCom([device({ permissions: ["music", "bible"] })]);

    await d.updateDevice("d1", { permissions: [] });

    expect(d.pendingDevice.value).toBeNull();
    /* E o `devices:changed` que o main devolve não pode reabrir a tela. */
    ouvintes.changed[0]?.(salvos.at(-1) as Device[]);
    expect(d.pendingDevice.value).toBeNull();
  });

  it("e continua não pendente depois de reiniciar o app", async () => {
    /*
     * Sem o campo `status`, a checagem do boot via lista vazia devolveria o
     * dispositivo para a fila de aprovação a cada abertura do LouvorJA.
     */
    await bootCom([device({ permissions: [] })]);
    const d = await bootCom([device({ permissions: [] })]);

    expect(d.pendingDevice.value).toBeNull();
    expect(d.devices.value[0].permissions).toEqual([]);
  });

  it("registro antigo (sem status e sem permissões) ainda abre a aprovação", async () => {
    /* Compatibilidade: o aparelho que chegou antes do campo não pode ficar
       esperando uma aprovação que a tela nunca vai mostrar. */
    const legado = device({ permissions: [] });
    delete legado.status;

    const d = await bootCom([legado]);

    expect(d.pendingDevice.value).toMatchObject({ id: "d1" });
  });

  it("um device marcado pending abre a aprovação mesmo após reiniciar", async () => {
    const d = await bootCom([device({ permissions: [], status: "pending" })]);

    expect(d.pendingDevice.value).toMatchObject({ id: "d1" });
  });

  it("salvar marca approved e limpa o pendente", async () => {
    const d = await bootCom([device({ permissions: [], status: "pending" })]);
    expect(d.pendingDevice.value).not.toBeNull();

    await d.acceptPendingDevice("Meu iPhone", []);

    expect(d.pendingDevice.value).toBeNull();
    expect(d.devices.value[0]).toMatchObject({ status: "approved", permissions: [] });
  });

  it("editar um device aprovado grava status approved", async () => {
    const d = await bootCom([device({ permissions: ["music"] })]);

    await d.updateDevice("d1", { name: "Celular do Operator" });

    expect(d.devices.value[0]).toMatchObject({
      name: "Celular do Operator",
      status: "approved",
    });
  });

  it("o evento devices:pending continua abrindo a tela", async () => {
    await bootCom([]);
    const d = useDevices();

    ouvintes.pending[0]?.(device({ permissions: [], status: "pending" }));

    expect(d.pendingDevice.value).toMatchObject({ id: "d1" });
  });
});
