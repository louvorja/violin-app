import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/constants/UserDataKeys";

const openMediaWindow = vi.fn();
const openPlatformWindow = vi.fn();
let onAir: Record<string, unknown> = {};

vi.mock("@/helpers/ProjectionWindows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/ProjectionWindows")>()),
  openMediaWindow: (kind: string, media: string, options: unknown) =>
    openMediaWindow(kind, media, options),
}));
// A paleta não pode ter a sua própria via até a plataforma: tudo passa por openMediaWindow.
vi.mock("@/helpers/Projection", () => ({
  open: (opts: unknown) => openPlatformWindow(opts),
  close: async () => {},
  isOpen: async () => false,
}));
vi.mock("@/helpers/AppData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in onAir ? onAir[key] : fallback) },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback?: unknown) => fallback },
}));
vi.mock("@/helpers/Modules", () => ({ default: {} }));
vi.mock("@/composables/useMedia", () => ({ default: { open: vi.fn() } }));

const registry = await import("@/helpers/CommandRegistry");
const CONFIG = KEYS.MODULES.MEDIA.CONFIG;

type Command = { id: string; run: () => void };

async function command(id: string): Promise<Command> {
  const all = (await registry.getAll(
    { get: async () => [] },
    { get: (_key: string, fallback: unknown) => fallback },
    (key: string) => key
  )) as Command[];
  const found = all.find((c) => c.id === id);
  if (!found) throw new Error(`comando ${id} não encontrado`);
  return found;
}

beforeEach(() => {
  openMediaWindow.mockClear();
  openPlatformWindow.mockClear();
  onAir = {};
});

describe("comandos de projeção da paleta abrem pela função única, com a mídia que está no ar", () => {
  it.each([
    ["projection:open", "projection"],
    ["operator:open", "operator"],
  ])("%s com música no ar", async (id, kind) => {
    (await command(id)).run();
    expect(openMediaWindow).toHaveBeenCalledWith(kind, "music", { explicit: true });
    expect(openPlatformWindow).not.toHaveBeenCalled();
  });

  it("'Abrir projeção' com vídeo no ar abre a projeção do vídeo, não a de música, que ficava preta em tela cheia", async () => {
    onAir = { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: "louvorja://onlinevideo/x.mp4" };
    (await command("projection:open")).run();
    expect(openMediaWindow).toHaveBeenCalledWith("projection", "video", { explicit: true });
    expect(openPlatformWindow).not.toHaveBeenCalled();
  });

  it("'Abrir projeção' com vídeo de arquivo no ar abre a projeção de arquivo", async () => {
    onAir = { [CONFIG.VIDEO_FILE]: true, [CONFIG.AUDIO]: "louvorja://local/videos/culto.mp4" };
    (await command("projection:open")).run();
    expect(openMediaWindow).toHaveBeenCalledWith("projection", "file", { explicit: true });
  });
});
