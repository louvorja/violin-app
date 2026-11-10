import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import $database from "@/helpers/Database";
import $liturgy, { musicDurationMinutes } from "@/helpers/Liturgy";

vi.mock("@/helpers/Database", () => ({ default: { getLocal: vi.fn() } }));

const CATALOG = [
  { id_music: 41, name: "Outra", duration: "00:02:00" },
  {
    id_music: 42,
    name: "Confiei no Meu Senhor",
    duration: "00:04:03",
    instrumental_duration: "00:06:10",
  },
];

describe("Liturgy.addMusic", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked($database.getLocal).mockReset();
  });

  it("entra com a duração da cantada, como o formulário calcula (#49)", async () => {
    vi.mocked($database.getLocal).mockResolvedValue(CATALOG);
    const item = await $liturgy.addMusic(42, "Confiei no Meu Senhor", true, undefined, 1);
    expect(item.duration).toBe(5);
    expect(item.subtipo).toBe("ja");
    expect($liturgy.list(1)).toHaveLength(1);
    expect(vi.mocked($database.getLocal).mock.calls[0][0]).toBe("pt_musics");
  });

  it("sem catálogo local a música entra mesmo assim, com 0 min", async () => {
    vi.mocked($database.getLocal).mockRejectedValue(new Error("offline"));
    const item = await $liturgy.addMusic(42, "Confiei no Meu Senhor", true, undefined, 2);
    expect(item.duration).toBe(0);
    expect($liturgy.list(2)).toHaveLength(1);
  });
});

describe("musicDurationMinutes", () => {
  it("arredonda para cima e usa a faixa da versão", () => {
    expect(musicDurationMinutes(CATALOG[1], "sung")).toBe(5);
    expect(musicDurationMinutes(CATALOG[1], "pb")).toBe(7);
    expect(musicDurationMinutes(CATALOG[1], "audio_pb")).toBe(7);
    expect(musicDurationMinutes(CATALOG[0], "pb")).toBe(2);
  });

  it("devolve null quando o catálogo não traz a duração", () => {
    expect(musicDurationMinutes({ id_music: 1 }, "sung")).toBeNull();
  });
});
