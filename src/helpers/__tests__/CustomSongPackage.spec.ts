/**
 * CustomSongPackage.spec.ts — Cantado e playback de uma música personalizada
 * indo e voltando como o par de arquivos que o LouvorJA clássico reconhece.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

vi.mock("@/helpers/AudioLibrary", () => {
  const store = new Map<string, Blob>();
  const digest = async (blob: Blob) =>
    Array.from(new Uint8Array(await blob.arrayBuffer())).join(".");
  const api = {
    importAudio: async (blob: Blob) => {
      const token = `lib://audio/${await digest(blob)}.mp3`;
      store.set(token, blob);
      return token;
    },
    importImage: async (blob: Blob) => {
      const token = `lib://image/${await digest(blob)}.png`;
      store.set(token, blob);
      return token;
    },
    setSessionAudio: (name: string, blob: Blob) => {
      store.set(`pkg://audio/${name}`, blob);
      return `pkg://audio/${name}`;
    },
    setSessionImage: (name: string, blob: Blob) => {
      store.set(`pkg://image/${name}`, blob);
      return `pkg://image/${name}`;
    },
    getAudioBlob: async (token: string) => store.get(token) || null,
    getImageBlob: async (token: string) => store.get(token) || null,
  };
  return { default: api, ...api };
});

import AudioLibrary from "@/helpers/AudioLibrary";
import SljaConverter from "@/helpers/SljaConverter";
import { hasPlayback, hasSung, slideTimes, type CustomSong } from "@/helpers/CustomSongs";
import { buildSongPackages, importSongFiles, readSongFile } from "@/helpers/CustomSongPackage";

/** O que o teste lê de um pacote reaberto. */
interface Reopened {
  meta: { nome?: string };
  audio: Blob | null;
  audioName: string | null;
  images: Map<string, Blob>;
  slides: Array<{ letra: string; tempo_seconds: number }>;
}
const reopen = async (blob: Blob) => (await SljaConverter.loadSlja(blob)) as Reopened;

const mp3 = (...tail: number[]) => new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...tail])]);
const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]);

function slide(letra: string, tempo: number, extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    tipo: "LETRA" as const,
    letra,
    letra_aux: "",
    tamanho_letra: 14,
    tamanho_letra_aux: 10,
    cor_letra: "#FFFFFF",
    cor_letra_aux: "#efb400",
    cor_fundo: "#000000",
    imagem: "",
    imagem_posicao: 5 as const,
    fundo_letra: true,
    tempo_seconds: tempo,
    text_align: "center" as const,
    ...extra,
  };
}

async function songWithBothTracks(): Promise<CustomSong> {
  const imagem = await AudioLibrary.importImage(png(), "fundo.png");
  return {
    id: "song-1",
    nome: "Hino Novo",
    audio_token: await AudioLibrary.importAudio(mp3(1), "hino.mp3"),
    audio_name: "hino.mp3",
    playback_token: await AudioLibrary.importAudio(mp3(2), "hino-pb.mp3"),
    playback_name: "hino-pb.mp3",
    slides: [
      slide("Hino Novo", 0, { tipo: "CAPA", imagem }),
      slide("verso 1", 10, { imagem, tempo_seconds_pb: 14 }),
      slide("verso 2", 20, { imagem }),
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const asFiles = (packages: Array<{ fileName: string; blob: Blob }>) =>
  packages.map((p) => new File([p.blob], p.fileName));

/** Pacote como o editor do clássico grava: barra invertida, sem `nome`, tempo só em bytes. */
async function delphiPackage(letras: string[], temposEmSegundos: number[], faixa: Blob) {
  const ini = ["[Geral]", `slides=${letras.length}`, "url_musica=audio\\Faixa.mp3", "audio=1", ""];
  letras.forEach((letra, i) => {
    ini.push(
      `[Slide:${i + 1}]`,
      `tipo=${i === 0 ? "CAPA" : "LETRA"}`,
      `letra=${letra}`,
      "fundo_letra=1",
      `tempo=${temposEmSegundos[i] * 176400}`,
      ""
    );
  });
  const zip = new JSZip();
  zip.file("slides.lja", SljaConverter.encodeCp1252(ini.join("\r\n")));
  zip.file("audio\\Faixa.mp3", faixa);
  return zip.generateAsync({ type: "blob" });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("nome do arquivo de playback", () => {
  it("segue a regra do clássico: traço e PB no fim, com espaço e caixa livres", () => {
    for (const name of ["Hino -PB", "Hino-PB", "Hino - PB", "Hino- pb", "Hino -Pb  "]) {
      expect(SljaConverter.playbackBaseName(name)).toBe("Hino");
    }
  });

  it("não confunde um nome comum com playback", () => {
    for (const name of ["Hino", "Hino PB", "Hino -PBX", "-PB", " - pb", "PB", ""]) {
      expect(SljaConverter.playbackBaseName(name)).toBeNull();
    }
  });
});

describe("exportação", () => {
  it("a música com as duas faixas sai como o par que o clássico pareia", async () => {
    const files = await buildSongPackages(await songWithBothTracks());
    expect(files.map((f) => f.fileName)).toEqual(["Hino Novo.slja", "Hino Novo -PB.slja"]);

    const [sung, playback] = await Promise.all(files.map((f) => reopen(f.blob)));
    expect(sung.audioName).toBe("hino.mp3");
    expect(playback.audioName).toBe("hino-pb.mp3");
    expect(sung.slides.map((s) => s.tempo_seconds)).toEqual([0, 10, 20]);
    // O playback leva os tempos dele, e herda os do cantado onde não tem.
    expect(playback.slides.map((s) => s.tempo_seconds)).toEqual([0, 14, 20]);
    expect(playback.meta.nome).toBe("Hino Novo");
    expect(playback.slides.map((s) => s.letra)).toEqual(sung.slides.map((s) => s.letra));
    expect([...playback.images.keys()]).toEqual([...sung.images.keys()]);
    // A mesma imagem nos três slides entra uma vez só no pacote.
    expect(sung.images.size).toBe(1);
  });

  it("só cantado continua saindo num arquivo, com o nome de sempre", async () => {
    const song = await songWithBothTracks();
    const files = await buildSongPackages({ ...song, playback_token: "", playback_name: "" });
    expect(files.map((f) => f.fileName)).toEqual(["Hino Novo.slja"]);
  });

  it("só playback sai apenas com o sufixo: o cantado iria sem faixa", async () => {
    const song = await songWithBothTracks();
    const files = await buildSongPackages({ ...song, audio_token: "", audio_name: "" });
    expect(files.map((f) => f.fileName)).toEqual(["Hino Novo -PB.slja"]);
    expect((await reopen(files[0].blob)).audioName).toBe("hino-pb.mp3");
  });

  it("sem áudio nenhum sai o pacote só de slides", async () => {
    const song = await songWithBothTracks();
    const files = await buildSongPackages({
      ...song,
      audio_token: "",
      playback_token: "lib://audio/apagado.mp3",
    });
    expect(files.map((f) => f.fileName)).toEqual(["Hino Novo.slja"]);
    expect((await reopen(files[0].blob)).audio).toBeNull();
  });

  it("troca no nome do arquivo o que o sistema de arquivos recusa", async () => {
    const song = await songWithBothTracks();
    const files = await buildSongPackages({ ...song, nome: 'Glória: "aleluia"' });
    expect(files.map((f) => f.fileName)).toEqual([
      "Glória_ _aleluia_.slja",
      "Glória_ _aleluia_ -PB.slja",
    ]);
  });
});

describe("importação", () => {
  it("o par exportado volta como uma música com as duas faixas", async () => {
    const original = await songWithBothTracks();
    const result = await importSongFiles(asFiles(await buildSongPackages(original)));

    expect(result).toMatchObject({ failed: 0, loose: 0, unmatched: 0 });
    expect(result.songs).toHaveLength(1);
    const [song] = result.songs;
    expect(song.nome).toBe("Hino Novo");
    expect(song.audio_token).toBe(original.audio_token);
    expect(song.playback_token).toBe(original.playback_token);
    expect(song.playback_name).toBe("hino-pb.mp3");
    expect(slideTimes(song.slides)).toEqual([0, 10, 20]);
    expect(slideTimes(song.slides, true)).toEqual([0, 14, 20]);
    // Só o slide que diverge guarda tempo próprio: os outros seguem o cantado.
    expect(song.slides.map((s) => s.tempo_seconds_pb)).toEqual([undefined, 14, undefined]);
  });

  it("a ordem dos arquivos no lote não importa", async () => {
    const files = asFiles(await buildSongPackages(await songWithBothTracks())).reverse();
    const { songs } = await importSongFiles(files);
    expect(songs).toHaveLength(1);
    expect(hasSung(songs[0]) && hasPlayback(songs[0])).toBe(true);
  });

  it("pareia o par gravado pelo clássico, com tempos em bytes e sufixo digitado à mão", async () => {
    const letras = ["Bênção", "Primeira linha", "Segunda linha"];
    const files = [
      new File([await delphiPackage(letras, [0, 8, 16], mp3(1))], "Bênção.slja"),
      new File([await delphiPackage(letras, [0, 9, 16], mp3(2))], "bênção - pb.slja"),
      new File([await delphiPackage(["Outra"], [0], mp3(3))], "Outra.slja"),
    ];
    const { songs, unmatched } = await importSongFiles(files);

    expect(unmatched).toBe(0);
    expect(songs.map((s) => s.nome)).toEqual(["Bênção", "Outra"]);
    expect(slideTimes(songs[0].slides)).toEqual([0, 8, 16]);
    expect(slideTimes(songs[0].slides, true)).toEqual([0, 9, 16]);
    expect(songs[0].audio_token).not.toBe(songs[0].playback_token);
    expect(hasPlayback(songs[1])).toBe(false);
  });

  it("playback com slides diferentes do cantado entra à parte, sem perder nada", async () => {
    const files = [
      new File([await delphiPackage(["Hino", "verso"], [0, 5], mp3(1))], "Hino.slja"),
      new File(
        [await delphiPackage(["Hino", "verso", "coda"], [0, 5, 9], mp3(2))],
        "Hino -PB.slja"
      ),
    ];
    const { songs, unmatched } = await importSongFiles(files);

    expect(unmatched).toBe(1);
    expect(songs).toHaveLength(2);
    expect([hasSung(songs[0]), hasPlayback(songs[0])]).toEqual([true, false]);
    expect([hasSung(songs[1]), hasPlayback(songs[1])]).toEqual([false, true]);
    expect(songs[1].slides).toHaveLength(3);
  });

  it("playback sozinho vira música só de playback, com o nome sem o sufixo", async () => {
    const pacote = await delphiPackage(["", "verso"], [0, 7], mp3(2));
    const { songs, unmatched } = await importSongFiles([new File([pacote], "Só Playback-PB.slja")]);

    expect(unmatched).toBe(0);
    expect(songs).toHaveLength(1);
    expect(songs[0].nome).toBe("Só Playback");
    expect(songs[0].audio_token).toBe("");
    expect(hasPlayback(songs[0])).toBe(true);
    expect(slideTimes(songs[0].slides, true)).toEqual([0, 7]);

    // E na exportação volta a ser só o arquivo de playback.
    const files = await buildSongPackages(songs[0]);
    expect(files.map((f) => f.fileName)).toEqual(["Só Playback -PB.slja"]);
  });

  it("conta o arquivo ilegível sem derrubar o resto do lote", async () => {
    const files = [
      new File(["isto não é uma apresentação"], "Quebrado.slja"),
      ...asFiles(await buildSongPackages(await songWithBothTracks())),
    ];
    const result = await importSongFiles(files);
    expect(result.failed).toBe(1);
    expect(result.songs).toHaveLength(1);
  });

  it("conta o .lja solto, que vem sem áudio nem imagens", async () => {
    const ini = "[Geral]\r\nslides=1\r\n[Slide:1]\r\ntipo=CAPA\r\nletra=Solto\r\n";
    const result = await importSongFiles([
      new File([SljaConverter.encodeCp1252(ini)], "Solto.lja"),
    ]);
    expect(result.loose).toBe(1);
    expect(result.songs[0].nome).toBe("Solto");
    expect(result.songs[0].audio_token).toBe("");
  });
});

describe("abrir no editor", () => {
  it("deixa a mídia na sessão e usa o nome de reserva quando o pacote não traz um", async () => {
    const pacote = await delphiPackage(["", "verso"], [0, 4], mp3(7));
    const { song, loose } = await readSongFile(new File([pacote], ".slja"), "Nova música");
    expect(loose).toBe(false);
    expect(song?.nome).toBe("Nova música");
    expect(song?.audio_token).toBe("pkg://audio/Faixa.mp3");
  });

  it("arquivo de playback abre na faixa de playback", async () => {
    const pacote = await delphiPackage(["Hino", "verso"], [0, 4], mp3(8));
    const { song } = await readSongFile(new File([pacote], "Hino -PB.slja"));
    expect(song?.audio_token).toBe("");
    expect(song?.playback_token).toBe("pkg://audio/Faixa.mp3");
    expect(song?.playback_name).toBe("Faixa.mp3");
  });
});

describe("classificação de faixa e pacote unificado (#62)", () => {
  it("export clássico grava faixa explícita para reimportar sem perguntar", async () => {
    const original = await songWithBothTracks();
    const sungOnly = await buildSongPackages({
      ...original,
      playback_token: "",
      playback_name: "",
    });
    const pbOnly = await buildSongPackages({
      ...original,
      audio_token: "",
      audio_name: "",
    });

    const classifyLegacyTracks = vi.fn();
    const res = await importSongFiles(
      asFiles([...sungOnly, ...pbOnly].map((f, i) => ({ ...f, fileName: `SemSufixo-${i}.slja` }))),
      { classifyLegacyTracks }
    );
    expect(classifyLegacyTracks).not.toHaveBeenCalled();
    expect(res.songs).toHaveLength(2);
    expect(hasSung(res.songs[0]) && !hasPlayback(res.songs[0])).toBe(true);
    expect(!hasSung(res.songs[1]) && hasPlayback(res.songs[1])).toBe(true);
  });

  it("arquivo legado sem etiqueta de faixa consulta o usuário e respeita Playback/Cancelar", async () => {
    const pacote = await delphiPackage(["Hino Legado", "verso"], [0, 6], mp3(9));
    const file = new File([pacote], "Hino Legado.slja");

    const cancelRes = await importSongFiles([file], {
      classifyLegacyTracks: async () => null,
    });
    expect(cancelRes.cancelled).toBe(true);
    expect(cancelRes.songs).toHaveLength(0);

    const pbRes = await importSongFiles([file], {
      classifyLegacyTracks: async (items) => {
        expect(items).toHaveLength(1);
        return { [items[0].key]: "playback" };
      },
    });
    expect(pbRes.songs).toHaveLength(1);
    expect(hasSung(pbRes.songs[0])).toBe(false);
    expect(hasPlayback(pbRes.songs[0])).toBe(true);
    expect(slideTimes(pbRes.songs[0].slides, true)).toEqual([0, 6]);
  });

  it("export unificado empacota as duas faixas num único .slja e restaura em 1 música", async () => {
    const original = await songWithBothTracks();
    const packages = await buildSongPackages(original, original.nome, { mode: "unified" });
    expect(packages).toHaveLength(1);
    expect(packages[0].fileName).toBe("Hino Novo.slja");

    const classifyLegacyTracks = vi.fn();
    const imported = await importSongFiles(asFiles(packages), { classifyLegacyTracks });
    expect(classifyLegacyTracks).not.toHaveBeenCalled();
    expect(imported.songs).toHaveLength(1);
    const [song] = imported.songs;
    expect(hasSung(song) && hasPlayback(song)).toBe(true);
    expect(song.audio_name).toBe("hino.mp3");
    expect(song.playback_name).toBe("hino-pb.mp3");
    expect(slideTimes(song.slides)).toEqual([0, 10, 20]);
    expect(slideTimes(song.slides, true)).toEqual([0, 14, 20]);
  });
});
