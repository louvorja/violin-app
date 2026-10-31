import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";
import { KEYS } from "@/constants/UserDataKeys";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const mocks = vi.hoisted(() => ({
  slots: [] as { id: string; enabled: boolean }[],
  userdata: new Map<string, unknown>(),
  send: vi.fn(),
  listen: vi.fn(),
  track: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/helpers/Overlay", () => ({
  readAllSlots: async () => mocks.slots.map((slot) => ({ ...slot })),
  writeSlot: async (slot: { id: string; enabled: boolean }) => {
    const indice = mocks.slots.findIndex((atual) => atual.id === slot.id);
    if (indice >= 0) mocks.slots[indice] = { ...slot };
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) =>
      mocks.userdata.has(key) ? mocks.userdata.get(key) : fallback,
    set: (key: string, value: unknown) => {
      mocks.userdata.set(key, value);
    },
  },
}));
vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: mocks.send,
    listen: (handler: (_msg: unknown) => void, options: unknown) => {
      mocks.listen(handler, options);
      return () => {};
    },
  },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: mocks.track, captureException: mocks.captureException },
}));

import {
  ativarOverlayVinculado,
  desativarOverlayVinculado,
  itemAssumePalco,
  prepararExecucao,
  resetarSessaoOverlayVinculado,
} from "../linkedOverlay";

function item(overrides: Partial<LiturgyItem> = {}): LiturgyItem {
  return {
    id: "item-1",
    tipo: LiturgyItemTypeEnum.ARQUIVO,
    item: "Aviso",
    dir: "/Users/ana/aviso.png",
    linked_overlay_id: "",
    ...overrides,
  } as LiturgyItem;
}

function musica(overrides: Partial<LiturgyItem> = {}): LiturgyItem {
  return item({
    tipo: LiturgyItemTypeEnum.MUSICA,
    id_music: 42,
    subtipo: "sung",
    escolha: false,
    ...overrides,
  });
}

function slot(id = "slot-1", enabled = false) {
  return { id, enabled };
}

const master = () => mocks.userdata.get(KEYS.MODULES.OVERLAY.ENABLED);
const proximoItem = () => item({ id: "item-2", item: "Próximo" });

beforeEach(() => {
  vi.clearAllMocks();
  resetarSessaoOverlayVinculado();
  mocks.slots = [];
  mocks.userdata.clear();
});

describe("ativarOverlayVinculado", () => {
  it("liga o slot, a chave geral e publica, guardando a sessão", async () => {
    mocks.slots = [slot()];
    await ativarOverlayVinculado(item({ linked_overlay_id: "slot-1" }));

    expect(mocks.slots[0].enabled).toBe(true);
    expect(master()).toBe(true);
    expect(mocks.send).toHaveBeenCalledWith(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, {
      slot: expect.objectContaining({ id: "slot-1", enabled: true }),
    });
    /* Fechar a mídia precisa recolher o overlay: listener sem replay. */
    expect(mocks.listen).toHaveBeenCalledWith(expect.any(Function), { replay: false });
  });

  it("sem vínculo ou com slot ausente não liga nada", async () => {
    await ativarOverlayVinculado(item());
    await ativarOverlayVinculado(item({ linked_overlay_id: "sumiu" }));

    expect(mocks.slots).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(master()).toBeUndefined();
  });

  it("trocar de item desliga o slot anterior antes de ligar o novo", async () => {
    mocks.slots = [slot("slot-1"), slot("slot-2")];
    await ativarOverlayVinculado(item({ linked_overlay_id: "slot-1" }));
    await ativarOverlayVinculado(item({ id: "item-2", linked_overlay_id: "slot-2" }));

    expect(mocks.slots).toEqual([
      { id: "slot-1", enabled: false },
      { id: "slot-2", enabled: true },
    ]);
  });

  it("mesmo item e mesmo slot já ligado não reescreve (não pisca)", async () => {
    mocks.slots = [slot()];
    const alvo = item({ linked_overlay_id: "slot-1" });
    await ativarOverlayVinculado(alvo);
    mocks.send.mockClear();

    await ativarOverlayVinculado(alvo);

    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("prepararExecucao", () => {
  it("outro item que assume o telão desliga e restaura a chave geral", async () => {
    mocks.slots = [slot()];
    await ativarOverlayVinculado(item({ linked_overlay_id: "slot-1" }));
    expect(master()).toBe(true);

    await prepararExecucao(proximoItem());

    expect(mocks.slots[0].enabled).toBe(false);
    expect(master()).toBe(false);
    expect(mocks.send).toHaveBeenLastCalledWith(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, {
      slot: expect.objectContaining({ id: "slot-1", enabled: false }),
    });
  });

  it("o mesmo item (troca de versão/replay) não desliga", async () => {
    mocks.slots = [slot()];
    await ativarOverlayVinculado(musica({ linked_overlay_id: "slot-1" }));

    await prepararExecucao(musica({ linked_overlay_id: "slot-1" }), "lyric");

    expect(mocks.slots[0].enabled).toBe(true);
  });

  it.each([
    ["anotação", item({ id: "n1", tipo: LiturgyItemTypeEnum.ANOTACAO })],
    ["botão de overlay", item({ id: "o1", tipo: LiturgyItemTypeEnum.OVERLAY })],
    ["som de fundo", item({ id: "b1", tipo: LiturgyItemTypeEnum.BG_SOUND })],
  ])("%s não encerra o item", async (_nome, semPalco) => {
    mocks.slots = [slot()];
    await ativarOverlayVinculado(item({ linked_overlay_id: "slot-1" }));

    await prepararExecucao(semPalco);

    expect(mocks.slots[0].enabled).toBe(true);
  });

  it("música só de áudio não assume o palco", async () => {
    mocks.slots = [slot()];
    await ativarOverlayVinculado(musica({ linked_overlay_id: "slot-1" }));

    await prepararExecucao(musica({ id: "m2", subtipo: "audio" }), "audio");
    expect(mocks.slots[0].enabled).toBe(true);

    await prepararExecucao(musica({ id: "m3", subtipo: "sung" }), "sung");
    expect(mocks.slots[0].enabled).toBe(false);
  });

  it("sem sessão não faz nada", async () => {
    mocks.slots = [slot()];
    await prepararExecucao(proximoItem());
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.slots[0].enabled).toBe(false);
  });
});

describe("desativarOverlayVinculado", () => {
  it("fechar a mídia desliga o overlay (listener de MEDIA_CLOSE)", async () => {
    mocks.slots = [slot()];
    await ativarOverlayVinculado(item({ linked_overlay_id: "slot-1" }));

    const listener = mocks.listen.mock.calls[0]?.[0] as (_msg: unknown) => void;
    listener({ type: BROADCAST_TYPE.MEDIA_CLOSE });

    await vi.waitFor(() => expect(mocks.slots[0].enabled).toBe(false));
    expect(master()).toBe(false);
  });

  it("chave geral já ligada antes do item permanece ligada no fim", async () => {
    mocks.userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);
    mocks.slots = [slot()];
    await ativarOverlayVinculado(item({ linked_overlay_id: "slot-1" }));

    await desativarOverlayVinculado();

    expect(mocks.slots[0].enabled).toBe(false);
    expect(master()).toBe(true);
  });

  it("slot já ativo antes do item é desligado no fim", async () => {
    mocks.userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);
    mocks.slots = [slot("slot-1", true)];
    await ativarOverlayVinculado(item({ linked_overlay_id: "slot-1" }));

    await desativarOverlayVinculado();

    expect(mocks.slots[0].enabled).toBe(false);
  });

  it("é idempotente e não mexe em nada sem sessão", async () => {
    mocks.slots = [slot()];
    await desativarOverlayVinculado();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.slots[0].enabled).toBe(false);
  });
});

describe("itemAssumePalco", () => {
  it.each([
    ["música com slides", musica({ subtipo: "sung" }), true],
    ["música sem áudio", musica({ subtipo: "no_audio" }), true],
    ["música só de áudio", musica({ subtipo: "audio" }), false],
    ["música a escolher", musica({ escolha: true }), false],
    ["arquivo", item(), true],
    ["anúncios", item({ tipo: LiturgyItemTypeEnum.ANUNCIOS }), true],
    ["site", item({ tipo: LiturgyItemTypeEnum.SITE }), true],
    ["anotação", item({ tipo: LiturgyItemTypeEnum.ANOTACAO }), false],
    ["som de fundo", item({ tipo: LiturgyItemTypeEnum.BG_SOUND }), false],
  ])("%s", (_nome, alvo, esperado) => {
    expect(itemAssumePalco(alvo)).toBe(esperado);
  });
});
