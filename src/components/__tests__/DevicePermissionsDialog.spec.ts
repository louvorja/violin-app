/**
 * Salvar um dispositivo SEM NENHUMA permissão pede confirmação.
 *
 * O save é legítimo — o aparelho continua cadastrado e simplesmente não
 * controla nada — mas é o resultado fácil de "Desmarcar todas" + "Salvar", e o
 * efeito é silencioso do lado do celular. A confirmação é reversível (há outro
 * Salvar logo depois) e some com o diálogo.
 *
 * O `LjDialog` renderiza por teleport: os botões vivem em `document.body`, não
 * no wrapper (mesma montagem dos specs de diálogo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountUi, makeI18n } from "@/components/ui/__tests__/mountUi";
import DevicePermissionsDialog from "../DevicePermissionsDialog.vue";
import $alert from "@/helpers/Alert";
import type { Device } from "@/types/Device";

vi.mock("@/helpers/Alert", () => ({
  default: { confirm: vi.fn(async () => true) },
}));

const confirmMock = $alert.confirm as unknown as ReturnType<typeof vi.fn>;

const DeviceBase: Device = {
  id: "d1",
  token: "t1",
  name: "iPhone do Operator",
  model: "iPhone 15",
  platform: "ios",
  registeredAt: "2026-01-01T00:00:00.000Z",
  permissions: ["music", "bible"],
  status: "approved",
};

/** Botão cujo texto começa com `prefixo` (o diálogo é traduzido). */
function botao(prefixo: string): HTMLButtonElement {
  const achado = Array.from(document.body.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(prefixo)
  );
  if (!achado) throw new Error(`botão "${prefixo}" não encontrado`);
  return achado;
}

/** Dispara um botão do DOM e deixa o Vue assentar. */
async function clicar(prefixo: string): Promise<void> {
  botao(prefixo).click();
  await flushPromises();
}

/**
 * Esvazia a lista como o operador faria: o botão alterna entre "Selecionar
 * todas" e "Desmarcar todas" conforme o estado, então leva os dois cliques.
 */
async function desmarcarTodas(): Promise<void> {
  await clicar("Selecionar todas");
  await clicar("Desmarcar todas");
}

async function montar(device: Device = { ...DeviceBase }, isPending = false) {
  const w = mountUi(
    DevicePermissionsDialog,
    { attachTo: document.body, props: { device, isPending } },
    "pt"
  );
  await flushPromises();
  return w;
}

beforeEach(() => {
  document.body.innerHTML = "";
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
});

describe("salvar sem nenhuma permissão", () => {
  it("pede confirmação antes de salvar", async () => {
    const w = await montar();
    await desmarcarTodas();

    await clicar("Salvar");

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(String(confirmMock.mock.calls[0][0])).toContain("permissão");
    expect(w.emitted("save")).toBeTruthy();
  });

  it("cancelar a confirmação não salva nada", async () => {
    confirmMock.mockResolvedValue(false);
    const w = await montar();
    await desmarcarTodas();

    await clicar("Salvar");

    expect(w.emitted("save")).toBeFalsy();
  });

  it("com ao menos uma permissão, salva direto, sem perguntar nada", async () => {
    const w = await montar();

    await clicar("Salvar");

    expect(confirmMock).not.toHaveBeenCalled();
    expect(w.emitted("save")).toBeTruthy();
    expect(w.emitted("save")?.[0]?.[2]).toEqual(["music", "bible"]);
  });

  it("a tela de aprovação também confirma antes de aprovar sem permissões", async () => {
    const w = await montar({ ...DeviceBase, permissions: [], status: "pending" }, true);

    await clicar("Aprovar");

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(w.emitted("save")).toBeTruthy();
  });

  it("a confirmação diz que o aparelho continua cadastrado", async () => {
    await montar();
    await desmarcarTodas();
    await clicar("Salvar");

    /* O texto precisa dizer o que acontece: inerte, não removido. */
    expect(String(confirmMock.mock.calls[0][0])).toContain("cadastrado");
  });
});
