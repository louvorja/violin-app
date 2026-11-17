import { describe, expect, it, vi } from "vitest";
import type { LiturgyItem } from "@/types/Liturgy";
import type { Program, ProgramItem } from "@/types/Presentation";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";

/**
 * O modal "Pronto para o culto" mostra o item e, junto, o arquivo de fato que
 * falta baixar: as versões da música (cantado/playback) e, na nuvem, o título
 * do item que usa o arquivo.
 */

const music = (id: number, url: string, instrumental = "") => ({
  id_music: id,
  name: `Música ${id}`,
  url_music: url,
  url_instrumental_music: instrumental,
});

vi.mock("@/helpers/Database", () => ({
  default: {
    get: async (key: string) => (key === "music_70" ? music(70, "/musics/pt/sung.mp3", "/musics/pt/pb.mp3") : null),
  },
}));
vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: true,
    listDir: vi.fn(async () => ({ ok: true, entries: [] })),
    storage: { checkLocal: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/helpers/MediaUrl", () => ({
  resolveMediaReference: (url: string) => (url ? { relativePath: url, url } : null),
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), captureException: vi.fn() },
}));
vi.mock("@/composables/useBackgroundTasks", () => ({
  useBackgroundTasks: () => ({
    registerTask: vi.fn(),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    cancelTask: vi.fn(),
  }),
}));
vi.mock("../useCloudFiles", () => ({
  useCloudFiles: () => ({ refresh: vi.fn(async () => {}), stateOf: () => "cloud" }),
}));
vi.mock("../useChurchFolder", () => ({ useChurchFolder: () => ({ root: { value: null } }) }));
vi.mock("../useFileLibrary", () => ({
  readFolder: vi.fn(async (dir: string) =>
    dir === "/igreja/Fotos" ? [{ path: "/igreja/Fotos/a.jpg", isDir: false, ext: "jpg" }] : []
  ),
}));

const { useReadiness } = await import("../useReadiness");

const liturgy = (patch: Partial<LiturgyItem>): LiturgyItem =>
  ({
    id: "l",
    tipo: LiturgyItemTypeEnum.ARQUIVO,
    subtipo: "",
    musica: 0,
    item: "",
    subitem: "",
    cor: "",
    duration: 0,
    dir: "",
    dir_info: "",
    url: "",
    escolha: false,
    has_instrumental_music: false,
    ...patch,
  }) as LiturgyItem;

const item = (patch: Partial<ProgramItem>): ProgramItem => ({
  id: "i",
  kind: "file",
  title: "",
  plannedMinutes: 5,
  ...patch,
});

const program: Program = {
  id: "2026-01-01",
  date: "2026-01-01",
  plannedStart: "09:00",
  createdAt: "",
  updatedAt: "",
  sessions: [
    {
      id: "s",
      label: "Culto",
      items: [
        item({
          id: "m1",
          kind: "music",
          title: "Hino inicial",
          source: liturgy({
            tipo: LiturgyItemTypeEnum.MUSICA,
            id_music: 70,
            musica: 70,
            subtipo: "",
            item: "Vinde, Povo do Senhor",
          }),
        }),
        item({
          id: "f1",
          title: "Abertura",
          source: liturgy({ dir: "/igreja/video.mp4" }),
        }),
        item({ id: "p1", kind: "folder", title: "Fotos do culto", folder: "/igreja/Fotos" }),
      ],
    },
  ],
};

describe("useReadiness — o que falta, de fato", () => {
  it("a música lista as versões e o arquivo que serão baixados", async () => {
    const readiness = useReadiness();
    await readiness.check(program);

    expect(readiness.state.songs.map((s) => [s.mode, s.remote])).toEqual([
      ["sung", "/musics/pt/sung.mp3"],
      ["pb", "/musics/pt/pb.mp3"],
    ]);
  });

  it("na nuvem, guarda o título do item que usa cada arquivo", async () => {
    const readiness = useReadiness();
    await readiness.check(program);

    expect(readiness.state.cloud).toEqual(["/igreja/video.mp4", "/igreja/Fotos/a.jpg"]);
    expect(readiness.state.cloudOwners).toEqual({
      "/igreja/video.mp4": "Abertura",
      "/igreja/Fotos/a.jpg": "Fotos do culto",
    });
  });
});
