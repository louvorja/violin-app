import { describe, it, expect } from "vitest";
import CustomSongs, { slideTimes } from "@/helpers/CustomSongs";
import { convertActiveTrack } from "../trackConversion";

describe("convertActiveTrack (#62)", () => {
  it("move Cantado -> Playback preservando áudio e tempos quando Playback está vazio", () => {
    const song = {
      audio_token: "lib://audio/pb-sem-sufixo.mp3",
      audio_name: "pb.mp3",
      playback_token: "",
      playback_name: "",
      slides: [
        CustomSongs.newSlide({ tipo: "CAPA", tempo_seconds: 0 }),
        CustomSongs.newSlide({ tipo: "LETRA", tempo_seconds: 12.345 }),
        CustomSongs.newSlide({ tipo: "LETRA", tempo_seconds: 24.5 }),
      ],
    };

    const res = convertActiveTrack(song, false);
    expect(res.nextIsPlayback).toBe(true);
    expect(res.audio_token).toBe("");
    expect(res.playback_token).toBe("lib://audio/pb-sem-sufixo.mp3");
    expect(res.playback_name).toBe("pb.mp3");
    expect(slideTimes(res.slides, true)).toEqual([0, 12.345, 24.5]);
    expect(slideTimes(res.slides, false)).toEqual([0, 0, 0]);
  });

  it("move Playback -> Cantado preservando áudio e tempos quando Cantado está vazio", () => {
    const song = {
      audio_token: "",
      audio_name: "",
      playback_token: "lib://audio/cantada.mp3",
      playback_name: "cantada.mp3",
      slides: [
        CustomSongs.newSlide({ tipo: "CAPA", tempo_seconds: 0 }),
        CustomSongs.newSlide({ tipo: "LETRA", tempo_seconds: 0, tempo_seconds_pb: 9.75 }),
      ],
    };

    const res = convertActiveTrack(song, true);
    expect(res.nextIsPlayback).toBe(false);
    expect(res.audio_token).toBe("lib://audio/cantada.mp3");
    expect(res.playback_token).toBe("");
    expect(slideTimes(res.slides, false)).toEqual([0, 9.75]);
    expect(res.slides[1].tempo_seconds_pb).toBeUndefined();
  });

  it("inverte ambas as faixas e seus tempos quando ambas possuem áudio", () => {
    const song = {
      audio_token: "lib://audio/pb.mp3",
      audio_name: "pb.mp3",
      playback_token: "lib://audio/cantado.mp3",
      playback_name: "cantado.mp3",
      slides: [
        CustomSongs.newSlide({ tipo: "CAPA", tempo_seconds: 0 }),
        CustomSongs.newSlide({ tipo: "LETRA", tempo_seconds: 8.2, tempo_seconds_pb: 10.5 }),
      ],
    };

    const res = convertActiveTrack(song, false);
    expect(res.nextIsPlayback).toBe(true);
    expect(res.audio_token).toBe("lib://audio/cantado.mp3");
    expect(res.playback_token).toBe("lib://audio/pb.mp3");
    expect(slideTimes(res.slides, false)).toEqual([0, 10.5]);
    expect(slideTimes(res.slides, true)).toEqual([0, 8.2]);
  });
});
