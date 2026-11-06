import { describe, expect, it } from "vitest";
import {
  ACTION_LITURGY_VERSION,
  LITURGY_VERSION_ACTION,
  MUSIC_EXECUTIONS,
  canExecute,
} from "@/config/MusicAction";
import { MusicActionEnum } from "@/enums/MusicActionEnum";

const enabled = (tracks: { sung: boolean; playback: boolean }) =>
  MUSIC_EXECUTIONS.filter((item) => canExecute(item, tracks)).map((item) => item.id);

describe("modos de execução de uma música", () => {
  it("lista os cinco na ordem dos botões das listas", () => {
    expect(MUSIC_EXECUTIONS.map((item) => item.id)).toEqual([
      "sing",
      "playback",
      "no-audio",
      "audio-only",
      "playback-only",
    ]);
  });

  it("com as duas faixas tudo vale", () => {
    expect(enabled({ sung: true, playback: true })).toHaveLength(5);
  });

  it("só cantada: sem as ações de playback", () => {
    expect(enabled({ sung: true, playback: false })).toEqual(["sing", "no-audio", "audio-only"]);
  });

  it("só playback: o cantado abriria os slides em silêncio, então não é oferecido", () => {
    expect(enabled({ sung: false, playback: true })).toEqual([
      "playback",
      "no-audio",
      "playback-only",
    ]);
  });

  it("sem áudio nenhum o cantado segue valendo: é ele que abre os slides", () => {
    expect(enabled({ sung: false, playback: false })).toEqual(["sing", "no-audio"]);
  });
});

describe("versão do item de liturgia", () => {
  it("na liturgia `audio` é só o arquivo; no player é slides com a cantada", () => {
    expect(LITURGY_VERSION_ACTION.audio).toBe(MusicActionEnum.AUDIO_ONLY);
    expect(LITURGY_VERSION_ACTION.sung).toBe(MusicActionEnum.AUDIO);
    expect(LITURGY_VERSION_ACTION.pb).toBe(MusicActionEnum.INSTRUMENTAL);
    expect(LITURGY_VERSION_ACTION.audio_pb).toBe(MusicActionEnum.PLAYBACK_ONLY);
    expect(LITURGY_VERSION_ACTION.lyric).toBe(MusicActionEnum.NO_AUDIO);
  });

  it("todo botão de execução volta para uma versão que toca a mesma ação", () => {
    for (const { action } of MUSIC_EXECUTIONS) {
      const version = ACTION_LITURGY_VERSION[action];
      expect(version, action).toBeDefined();
      expect(LITURGY_VERSION_ACTION[version!]).toBe(action);
    }
  });
});
