import { describe, it, expect, vi, beforeEach } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import type { ProgramItem } from "@/types/Presentation";
import { liturgyItem } from "../../program/liturgy";

const open = vi.fn(async () => {});
const openAudio = vi.fn(async () => {});
const stop = vi.fn();
const executeItem = vi.fn();

vi.mock("@/composables/useMedia", () => ({ default: { open, openAudio, stop } }));
const openCustomMusic = vi.fn(async () => true);
vi.mock("@/helpers/CustomMusicCatalog", () => ({ openCustomMusic }));
vi.mock("@/modules/liturgy/composables/useLiturgyExecution", () => ({
  useLiturgyExecution: () => ({ executeItem }),
}));

const { useProgramExecution } = await import("../useProgramExecution");

function music(fields: Partial<Parameters<typeof liturgyItem>[0]> = {}): ProgramItem {
  return {
    id: "i1",
    kind: "music",
    title: "Grande Comandante",
    plannedMinutes: 3,
    source: liturgyItem({ id: "s1", tipo: LiturgyItemTypeEnum.MUSICA, id_music: 70, musica: 70, subtipo: "sung", ...fields }),
  };
}

/**
 * Música com letra toca minimizada para a grade do palco; o que não tem letra
 * ou precisa de escolha continua no caminho da liturgia.
 */
describe("useProgramExecution", () => {
  beforeEach(() => {
    open.mockClear();
    openAudio.mockClear();
    executeItem.mockClear();
  });

  it("música cantada abre minimizada, sem passar pela liturgia", () => {
    useProgramExecution().execute(music());
    expect(open).toHaveBeenCalledWith({ id_music: 70, mode: MusicActionEnum.AUDIO, minimized: true });
    expect(executeItem).not.toHaveBeenCalled();
  });

  it("versão em aberto: toca a escolhida agora; a do item, quando definida, vence", () => {
    useProgramExecution().execute(music({ subtipo: "" }), "pb");
    useProgramExecution().execute(music({ subtipo: "lyric" }), "pb");
    expect(open.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { id_music: 70, mode: MusicActionEnum.INSTRUMENTAL, minimized: true },
      { id_music: 70, mode: MusicActionEnum.NO_AUDIO, minimized: true },
    ]);
  });

  it("playback e só letra também vão para a grade", () => {
    useProgramExecution().execute(music({ subtipo: "pb" }));
    useProgramExecution().execute(music({ subtipo: "lyric" }));
    expect(open.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { id_music: 70, mode: MusicActionEnum.INSTRUMENTAL, minimized: true },
      { id_music: 70, mode: MusicActionEnum.NO_AUDIO, minimized: true },
    ]);
  });

  it("só áudio toca sem ir às telas, cantado ou playback", () => {
    useProgramExecution().execute(music({ subtipo: "audio" }));
    useProgramExecution().execute(music({ subtipo: "audio_pb" }));
    expect(openAudio.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { id_music: 70, mode: MusicActionEnum.AUDIO },
      { id_music: 70, mode: MusicActionEnum.INSTRUMENTAL },
    ]);
    expect(open).not.toHaveBeenCalled();
    expect(executeItem).not.toHaveBeenCalled();
  });

  it("música a escolher segue pela liturgia, que pede a escolha", () => {
    useProgramExecution().execute(music({ escolha: true }));
    expect(open).not.toHaveBeenCalled();
    expect(executeItem).toHaveBeenCalledTimes(1);
  });

  it("música personalizada toca pelo palco, minimizada, no formato do item", () => {
    openCustomMusic.mockClear();
    useProgramExecution().execute(music({ id_music: -3, ref_id: "custom", subtipo: "pb" }));
    expect(openCustomMusic).toHaveBeenCalledWith("custom", MusicActionEnum.INSTRUMENTAL, { minimized: true });
    expect(executeItem).not.toHaveBeenCalled();
  });

  it("item com sub-itens não executa", () => {
    const announcements: ProgramItem = {
      id: "n",
      kind: "announcements",
      title: "Anúncios",
      plannedMinutes: 5,
      children: [{ id: "c", title: "Aviso", kind: "image" }],
    };
    expect(useProgramExecution().execute(announcements)).toBe(false);
    expect(executeItem).not.toHaveBeenCalled();
  });
});
