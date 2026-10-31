import { beforeEach, describe, expect, it, vi } from "vitest";
import { MUSIC_EXECUTIONS, canExecute } from "@/config/MusicAction";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { executeMusic } from "../MusicExecution";

const mocks = vi.hoisted(() => ({
  open: vi.fn(async () => true),
  openAudio: vi.fn(),
  openCustomMusic: vi.fn(async () => true),
}));

vi.mock("@/composables/useMedia", () => ({
  default: { open: mocks.open, openAudio: mocks.openAudio },
}));
vi.mock("@/helpers/CustomMusicCatalog", () => ({ openCustomMusic: mocks.openCustomMusic }));

beforeEach(() => vi.clearAllMocks());

describe("executeMusic", () => {
  it.each([
    [MusicActionEnum.AUDIO, "open", { id_music: 7, mode: MusicActionEnum.AUDIO }],
    [MusicActionEnum.INSTRUMENTAL, "open", { id_music: 7, mode: MusicActionEnum.INSTRUMENTAL }],
    [MusicActionEnum.NO_AUDIO, "open", 7],
    [MusicActionEnum.AUDIO_ONLY, "openAudio", 7],
    [
      MusicActionEnum.PLAYBACK_ONLY,
      "openAudio",
      { id_music: 7, mode: MusicActionEnum.INSTRUMENTAL },
    ],
  ] as const)("música do acervo em %s", (action, method, arg) => {
    void executeMusic({ id_music: 7 }, action);
    expect(mocks[method]).toHaveBeenCalledWith(arg);
    expect(mocks.openCustomMusic).not.toHaveBeenCalled();
  });

  it("sem modo pedido, a do acervo faz o mesmo que o primeiro botão da linha", () => {
    // No acervo toda música tem a faixa cantada.
    const first = MUSIC_EXECUTIONS.find((item) =>
      canExecute(item, { sung: true, playback: false })
    );
    void executeMusic({ id_music: 7 });
    void executeMusic({ id_music: 7 }, first?.action);
    expect(mocks.open.mock.calls[0]).toEqual(mocks.open.mock.calls[1]);
  });

  it("personalizada vai pelo UUID, nunca pelo id negativo da lista", () => {
    void executeMusic({ id_music: -3, custom_song_id: "uuid-1" }, MusicActionEnum.INSTRUMENTAL);
    void executeMusic({ id_music: -3, custom_song_id: "uuid-1" });
    expect(mocks.openCustomMusic).toHaveBeenNthCalledWith(
      1,
      "uuid-1",
      MusicActionEnum.INSTRUMENTAL
    );
    expect(mocks.openCustomMusic).toHaveBeenNthCalledWith(2, "uuid-1", undefined);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("devolve a promessa do player para quem precisa esperar (controle remoto)", async () => {
    await expect(executeMusic({ id_music: 7 }, MusicActionEnum.AUDIO)).resolves.toBe(true);
  });
});
