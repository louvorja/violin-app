import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Program, ProgramItem } from "@/types/Presentation";

/**
 * "Preparar tudo" do programa: os arquivos da nuvem e os hinos baixam em uma
 * única tarefa em segundo plano, que o operador acompanha (e cancela) no topo,
 * mesmo depois de fechar o modal.
 */

const registerTask = vi.fn();
const updateTask = vi.fn();
const completeTask = vi.fn();
const cancelTask = vi.fn();
const download = vi.fn(async (_path: string) => true);
const fetchWithTimeout = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
const track = vi.fn();
const captureException = vi.fn();

vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: false,
    listDir: vi.fn(async () => ({ ok: true, entries: [] })),
    storage: { checkLocal: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/helpers/Http", () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...(args as [])),
  NET_TIMEOUT: { MEDIA: 1 },
}));
vi.mock("@/helpers/Path", () => ({ default: { file: (url: string) => url } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: (...a: unknown[]) => track(...a), captureException: (...a: unknown[]) => captureException(...a) },
}));
vi.mock("@/helpers/Database", () => ({ default: { get: vi.fn(async () => null) } }));
vi.mock("@/helpers/MediaUrl", () => ({
  resolveMediaReference: (url: string) => ({ relativePath: url, url }),
}));
vi.mock("@/composables/useBackgroundTasks", () => ({
  useBackgroundTasks: () => ({ registerTask, updateTask, completeTask, cancelTask }),
}));
vi.mock("@/i18n", () => ({
  i18nAtual: () => ({
    global: {
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
    },
  }),
}));
vi.mock("../useCloudFiles", () => ({
  useCloudFiles: () => ({ download, refresh: vi.fn(async () => {}), stateOf: () => "cloud" }),
}));
vi.mock("../useChurchFolder", () => ({ useChurchFolder: () => ({ root: { value: null } }) }));
vi.mock("../useFileLibrary", () => ({ readFolder: vi.fn(async () => []) }));

const { useReadiness } = await import("../useReadiness");

const program = { sessions: [] } as unknown as Program;
const song = (url: string): { item: ProgramItem; remote: string; url: string } => ({
  item: {} as ProgramItem,
  remote: url,
  url,
});

describe("useReadiness — preparar em segundo plano", () => {
  beforeEach(() => {
    for (const fn of [registerTask, updateTask, completeTask, cancelTask, download, fetchWithTimeout, track, captureException])
      fn.mockClear();
    download.mockResolvedValue(true);
  });

  it("baixa nuvem e hinos em uma tarefa só, com progresso", async () => {
    const readiness = useReadiness();
    readiness.state.songs = [song("/hinos/pt/1.mp3"), song("/hinos/pt/2.mp3")];
    readiness.state.cloud = ["/igreja/video.mp4"];

    expect(readiness.prepare(program, "Preparando o culto")).toBe(true);
    expect(registerTask).toHaveBeenCalledOnce();
    expect(readiness.state.preparing).toBe(true);

    await vi.waitFor(() => expect(completeTask).toHaveBeenCalledOnce());
    expect(download).toHaveBeenCalledWith("/igreja/video.mp4");
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(updateTask).toHaveBeenCalled();
    expect(readiness.state.preparing).toBe(false);
    expect(track).toHaveBeenCalledWith("presentation_readiness_prepared", { songs: 2, cloud: 1 });
  });

  it("não começa um segundo preparo enquanto o primeiro roda", async () => {
    const readiness = useReadiness();
    readiness.state.cloud = ["/igreja/a.mp4"];
    let liberar: ((_ok: boolean) => void) | undefined;
    download.mockReturnValue(
      new Promise<boolean>((resolve) => {
        liberar = resolve;
      })
    );

    expect(readiness.prepare(program, "Preparando o culto")).toBe(true);
    expect(readiness.prepare(program, "Preparando o culto")).toBe(false);
    expect(registerTask).toHaveBeenCalledOnce();

    liberar?.(true);
    await vi.waitFor(() => expect(completeTask).toHaveBeenCalledOnce());
    expect(readiness.state.preparing).toBe(false);
  });

  it("cancelar a tarefa para o que ainda não começou", async () => {
    const readiness = useReadiness();
    readiness.state.cloud = ["/igreja/a.mp4", "/igreja/b.mp4"];
    let cancelar: (() => void) | undefined;
    registerTask.mockImplementation((_id, _label, stop) => {
      cancelar = stop;
    });
    download.mockImplementation(async (path: string) => {
      if (path === "/igreja/a.mp4") cancelar?.();
      return true;
    });

    readiness.prepare(program, "Preparando o culto");
    await vi.waitFor(() => expect(cancelTask).toHaveBeenCalledOnce());
    expect(download).toHaveBeenCalledTimes(1);
    expect(readiness.state.preparing).toBe(false);
  });
});
