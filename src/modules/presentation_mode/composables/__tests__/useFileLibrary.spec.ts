import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  return { store, listDir: vi.fn() };
});
vi.mock("@/helpers/UserData", async () => {
  const { reactive } = await import("vue");
  const data = reactive(m.store);
  return {
    default: {
      get: (key: string, fallback: unknown) => (key in data ? data[key] : fallback),
      set: (key: string, value: unknown) => (data[key] = value),
    },
  };
});
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: true, listDir: m.listDir } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { captureException: vi.fn(), track: vi.fn() } }));

import { KEYS } from "@/constants/UserDataKeys";
import $userdata from "@/helpers/UserData";
import { ALL, FAVORITES, inScope, useFileLibrary } from "../useFileLibrary";

const entry = (name: string, isDir = false) => ({
  name,
  path: `/culto/${name}`,
  isDir,
  ext: isDir ? "" : name.split(".").pop()!,
  size: 1,
  mtimeMs: 0,
});
const FOLDER = [
  entry("Avisos", true),
  entry("foto.jpg"),
  entry("hino.mp3"),
  entry("intro.mp4"),
  entry("sermao.pdf"),
];
const names = (lib: ReturnType<typeof useFileLibrary>) => lib.entries.value.map((e) => e.name);

beforeEach(() => {
  m.listDir.mockResolvedValue({ ok: true, entries: FOLDER });
  $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS, [{ path: "/culto", label: "culto" }]);
  $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FAVORITES, []);
});

describe("inScope", () => {
  it("Arquivos aceita tudo o que o app projeta; Mídia, fotos e vídeos; Áudio, áudios", () => {
    const kinds = (scope: "files" | "media" | "audio") =>
      FOLDER.filter((e) => !e.isDir && inScope(e, scope)).map((e) => e.name);
    expect(kinds("files")).toEqual(["foto.jpg", "hino.mp3", "intro.mp4", "sermao.pdf"]);
    expect(kinds("media")).toEqual(["foto.jpg", "intro.mp4"]);
    expect(kinds("audio")).toEqual(["hino.mp3"]);
  });

  it("pastas entram em todo recorte: é por elas que se navega", () => {
    expect(inScope(entry("Avisos", true), "audio")).toBe(true);
  });
});

describe("useFileLibrary por aba", () => {
  it("cada aba mostra o seu recorte da mesma pasta", async () => {
    const files = useFileLibrary("files");
    const media = useFileLibrary("media");
    const audio = useFileLibrary("audio");
    await Promise.all([files.openSource("/culto"), media.openSource("/culto"), audio.openSource("/culto")]);
    expect(names(files)).toEqual(["Avisos", "foto.jpg", "hino.mp3", "intro.mp4", "sermao.pdf"]);
    expect(names(media)).toEqual(["Avisos", "foto.jpg", "intro.mp4"]);
    expect(names(audio)).toEqual(["Avisos", "hino.mp3"]);
  });

  it("Tudo e as contagens respeitam o recorte", async () => {
    const media = useFileLibrary("media");
    await media.openSource(ALL);
    await media.load();
    expect(names(media)).toEqual(["foto.jpg", "intro.mp4"]);
    expect(media.counts.value).toMatchObject({ [ALL]: 2, "/culto": 2 });
  });

  it("a navegação de uma aba não mexe na outra", async () => {
    const files = useFileLibrary("files");
    const audio = useFileLibrary("audio");
    await files.openSource(FAVORITES);
    await audio.openSource("/culto");
    expect(files.source.value).toBe(FAVORITES);
    expect(audio.source.value).toBe("/culto");
  });

  it("favorito marcado numa aba aparece filtrado nas outras", async () => {
    const files = useFileLibrary("files");
    const media = useFileLibrary("media");
    await media.openSource(FAVORITES);
    files.toggleFavorite(entry("hino.mp3"));
    files.toggleFavorite(entry("foto.jpg"));
    await vi.waitFor(() => expect(names(media)).toEqual(["foto.jpg"]));
    await vi.waitFor(() => expect(media.counts.value[FAVORITES]).toBe(1));
  });

  it("pastas, favoritos e fila são os mesmos em todas as abas", () => {
    const files = useFileLibrary("files");
    const audio = useFileLibrary("audio");
    expect(audio.folders).toBe(files.folders);
    expect(audio.queue).toBe(files.queue);
  });
});
