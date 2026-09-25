/**
 * useLiturgyExecution.spec.ts — Item de arquivo da liturgia.
 *
 * O caso que importa: um .slja tem de tocar dentro do app. Antes, a extensão
 * desconhecida caía no "abrir com o sistema" e o operador via o LouvorJA
 * antigo abrir por cima, no meio do culto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  openSlja: vi.fn(),
  openPath: vi.fn(),
  openAudio: vi.fn(),
  projectFile: vi.fn(),
  systemPlayer: false,
}));

vi.mock("../../i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key }),
  chaveLiturgia: (key: string) => key,
}));
vi.mock("@/helpers/SljaPlayer", () => ({ openSlja: mocks.openSlja, SLJA_EXT: "slja" }));
vi.mock("@/helpers/Platform", () => ({
  default: { isDesktop: true, api: { shell: { openPath: mocks.openPath } } },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback: unknown) => (mocks.systemPlayer ? true : fallback) },
}));
vi.mock("@/composables/useMedia", () => ({
  default: { close: vi.fn(), stop: vi.fn(), openAudio: mocks.openAudio, projectFile: mocks.projectFile },
}));
vi.mock("@/composables/useBackgroundSound", () => ({
  useBackgroundSound: () => ({ currentFile: { value: null } }),
}));
vi.mock("@/composables/useFileProjection", () => ({ useFileProjection: () => ({ start: vi.fn() }) }));
vi.mock("@/helpers/Liturgy", () => ({ default: {} }));
vi.mock("@/helpers/ImageConvert", () => ({ heicToJpeg: vi.fn() }));
vi.mock("@/helpers/Alert", () => ({ default: { error: vi.fn(), info: vi.fn(), show: vi.fn() } }));
vi.mock("@/helpers/Broadcast", () => ({ default: { send: vi.fn() } }));
vi.mock("@/helpers/ProjectionWindows", () => ({
  openFileProjectionWindows: vi.fn(async () => {}),
  openAnnouncementsWindow: vi.fn(),
}));
vi.mock("@/helpers/AppData", () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/helpers/IndexedDB", () => ({ default: {} }));
vi.mock("@/helpers/Overlay", () => ({ readAllSlots: vi.fn(), writeSlot: vi.fn() }));
vi.mock("@/helpers/CustomSongs", () => ({ getSong: vi.fn() }));
vi.mock("@/helpers/Http", () => ({ fetchWithTimeout: vi.fn(), NET_TIMEOUT: { MEDIA: 1 } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), captureException: vi.fn() },
}));

import { useLiturgyExecution } from "../useLiturgyExecution";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";

function arquivo(dir: string, item = "Arquivo"): LiturgyItem {
  return { id: "1", tipo: LiturgyItemTypeEnum.ARQUIVO, item, dir } as LiturgyItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.systemPlayer = false;
  mocks.openSlja.mockResolvedValue(true);
  mocks.openPath.mockResolvedValue({ ok: true });
  mocks.openAudio.mockResolvedValue(undefined);
  mocks.projectFile.mockResolvedValue(true);
});

describe("liturgia — item de arquivo .slja", () => {
  it("apresenta dentro do app, sem entregar ao sistema", async () => {
    const { executeItem } = useLiturgyExecution();

    executeItem(arquivo("C:\\Culto\\hino.slja", "Hino de abertura"));

    await vi.waitFor(() => expect(mocks.openSlja).toHaveBeenCalledTimes(1));
    expect(mocks.openSlja).toHaveBeenCalledWith("louvorja://local/C:/Culto/hino.slja", {
      title: "Hino de abertura",
      origin: "liturgy",
    });
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("caminho Unix e extensão em maiúsculas também ficam no app", async () => {
    const { executeItem } = useLiturgyExecution();

    executeItem(arquivo("/Users/ana/Slides/Anúncios.SLJA"));

    await vi.waitFor(() => expect(mocks.openSlja).toHaveBeenCalledTimes(1));
    expect(mocks.openSlja.mock.calls[0][0]).toBe(
      "louvorja://local/Users/ana/Slides/An%C3%BAncios.SLJA"
    );
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("com o reprodutor do sistema ligado, .slja continua no app", async () => {
    mocks.systemPlayer = true;
    const { executeItem } = useLiturgyExecution();

    executeItem(arquivo("/Users/ana/hino.slja"));

    await vi.waitFor(() => expect(mocks.openSlja).toHaveBeenCalledTimes(1));
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("controle: com a preferência ligada, um vídeo ainda vai para o sistema", async () => {
    mocks.systemPlayer = true;
    const { executeItem } = useLiturgyExecution();

    executeItem(arquivo("/Users/ana/aviso.mp4"));

    await vi.waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith("/Users/ana/aviso.mp4"));
    expect(mocks.openSlja).not.toHaveBeenCalled();
  });

  it("imagem e vídeo passam pela posse de palco compartilhada antes de publicar", async () => {
    const { executeItem } = useLiturgyExecution();
    executeItem(arquivo("/Users/ana/aviso.png", "Aviso"));
    await vi.waitFor(() => expect(mocks.projectFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image", title: "Aviso" })
    ));

    executeItem(arquivo("/Users/ana/aviso.mp4", "Vídeo"));
    await vi.waitFor(() => expect(mocks.projectFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "video", title: "Vídeo" }),
      expect.any(String)
    ));
  });
});
