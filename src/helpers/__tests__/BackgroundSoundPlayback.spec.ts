import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { MediaFile } from "@/types/Media";

const h = vi.hoisted(() => ({
  defaultId: "" as string,
  library: new Map<string, unknown>(),
}));

const bg = {
  isPlaying: ref(false),
  currentFile: ref<MediaFile | null>(null),
  unplayableFile: ref<MediaFile | null>(null),
  fadeInMs: ref(1200),
  playFile: vi.fn(),
  resume: vi.fn(),
};

vi.mock("@/composables/useBackgroundSound", () => ({ useBackgroundSound: () => bg }));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback?: unknown) => h.defaultId || fallback },
}));
vi.mock("@/helpers/IndexedDB", () => ({
  default: { get: async (_table: string, id: string) => h.library.get(id) },
}));

import {
  playBackgroundSoundRecord,
  playDefaultBackgroundSound,
} from "@/helpers/BackgroundSoundPlayback";

const record: MediaFile = {
  id: "padrao",
  name: "Prelúdio",
  fileName: "preludio.mp3",
  path: "louvorja://files/background-sound/padrao/preludio.mp3",
};

/**
 * Som padrão: a mesma função atende o controle remoto (`play-default`) e o
 * botão "Tocar" da guia do módulo, que não fazia nada sem faixa carregada.
 */
describe("playDefaultBackgroundSound", () => {
  beforeEach(() => {
    h.defaultId = "";
    h.library.clear();
    bg.isPlaying.value = false;
    bg.currentFile.value = null;
    bg.unplayableFile.value = null;
    bg.playFile.mockClear();
    bg.resume.mockClear();
  });

  it("sem som marcado como padrão não toca nada", async () => {
    expect(await playDefaultBackgroundSound()).toBe("missing");
    expect(bg.playFile).not.toHaveBeenCalled();
  });

  it("padrão que saiu da biblioteca conta como ausente", async () => {
    h.defaultId = "apagado";

    expect(await playDefaultBackgroundSound()).toBe("missing");
    expect(bg.playFile).not.toHaveBeenCalled();
  });

  it("toca o padrão com o fade-in configurado", async () => {
    h.defaultId = record.id;
    h.library.set(record.id, record);

    expect(await playDefaultBackgroundSound()).toBe("started");

    expect(bg.playFile).toHaveBeenCalledWith({ ...record, path: record.path }, 1200);
  });

  it("não reinicia o padrão que já está tocando", async () => {
    h.defaultId = record.id;
    h.library.set(record.id, record);
    bg.currentFile.value = record;
    bg.isPlaying.value = true;

    expect(await playDefaultBackgroundSound()).toBe("already_playing");

    expect(bg.playFile).not.toHaveBeenCalled();
    expect(bg.resume).not.toHaveBeenCalled();
  });

  it("pausado no próprio padrão, continua de onde parou", async () => {
    h.defaultId = record.id;
    h.library.set(record.id, record);
    bg.currentFile.value = record;

    expect(await playDefaultBackgroundSound()).toBe("resumed");

    expect(bg.resume).toHaveBeenCalledTimes(1);
    expect(bg.playFile).not.toHaveBeenCalled();
  });

  it("registro sem bytes nem caminho é avisado, não tocado", async () => {
    const vazio = { ...record, path: "" };
    h.defaultId = record.id;
    h.library.set(record.id, vazio);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await playDefaultBackgroundSound()).toBe("unplayable");

    expect(bg.playFile).not.toHaveBeenCalled();
    expect(bg.unplayableFile.value).toEqual(vazio);
    warn.mockRestore();
  });
});

describe("playBackgroundSoundRecord", () => {
  beforeEach(() => {
    bg.playFile.mockClear();
    bg.unplayableFile.value = null;
  });

  it("toca o registro pedido", () => {
    expect(playBackgroundSoundRecord(record)).toBe(true);
    expect(bg.playFile).toHaveBeenCalledWith({ ...record, path: record.path }, 1200);
  });
});
