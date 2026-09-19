/**
 * SljaPlayer.spec.ts — Abrir um .slja dentro do app, sem passar pelo sistema.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  openCustomSong: vi.fn(),
  alertError: vi.fn(),
  captureException: vi.fn(),
  track: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock("@/composables/useMedia", () => ({ default: { openCustomSong: mocks.openCustomSong } }));
vi.mock("@/helpers/Alert", () => ({ default: { error: mocks.alertError } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { captureException: mocks.captureException, track: mocks.track },
}));
vi.mock("@/helpers/Http", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  NET_TIMEOUT: { MEDIA: 30000 },
}));

import SljaConverter from "@/helpers/SljaConverter";
import { openSlja, SLJA_EXT } from "@/helpers/SljaPlayer";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

function slide(overrides: Record<string, unknown> = {}) {
  return {
    tipo: "LETRA",
    letra: "verso",
    letra_aux: "",
    tamanho_letra: 14,
    tamanho_letra_aux: 10,
    cor_letra: "#FFFFFF",
    cor_letra_aux: "#efb400",
    fundo_letra: true,
    cor_fundo: "#000000",
    imagem: "",
    imagem_posicao: 5,
    tempo_seconds: 0,
    text_align: "center",
    ...overrides,
  };
}

async function pacote({ nome = "Hino do Pacote", comAudio = true, slides = [] as unknown[] } = {}) {
  const lista = slides.length
    ? slides
    : [
        slide({ tipo: "CAPA", letra: "Capa", imagem: "imagens/fundo.png" }),
        slide({ letra: "verso 1", imagem: "imagens/fundo.png", tempo_seconds: 5 }),
      ];
  return SljaConverter.writeSlja({
    nome,
    slides: lista,
    audio: comAudio ? new Blob([mp3]) : null,
    audioName: "musica.mp3",
    images: new Map([["imagens/fundo.png", new Blob([png])]]),
  });
}

let counter = 0;
const createObjectURL = vi.fn(() => `blob:test/${++counter}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  counter = 0;
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  mocks.openCustomSong.mockResolvedValue(undefined);
});

describe("openSlja", () => {
  it("expõe a extensão que o app reconhece", () => {
    expect(SLJA_EXT).toBe("slja");
  });

  it("toca o pacote como música personalizada, com áudio e imagens em blob:", async () => {
    const ok = await openSlja(await pacote(), { origin: "liturgy" });

    expect(ok).toBe(true);
    expect(mocks.openCustomSong).toHaveBeenCalledTimes(1);
    const song = mocks.openCustomSong.mock.calls[0][0];
    expect(song.nome).toBe("Hino do Pacote");
    expect(song.audio_token).toMatch(/^blob:/);
    expect(song.slides).toHaveLength(2);
    expect(song.slides.every((s: { imagem: string }) => /^blob:/.test(s.imagem))).toBe(true);
    expect(song.slides[1].tempo_seconds).toBe(5);
    expect(mocks.alertError).not.toHaveBeenCalled();
  });

  it("pacote sem áudio abre sem audio_token", async () => {
    await openSlja(await pacote({ comAudio: false }));

    expect(mocks.openCustomSong.mock.calls[0][0].audio_token).toBe("");
  });

  it("o título do chamador vence o nome gravado no pacote", async () => {
    await openSlja(await pacote(), { title: "  Abertura do culto " });

    expect(mocks.openCustomSong.mock.calls[0][0].nome).toBe("Abertura do culto");
  });

  it("sem nome no pacote, usa o do arquivo", async () => {
    const blob = await pacote({
      nome: "",
      slides: [slide({ tipo: "LETRA", letra: "" })],
    });

    await openSlja(blob, { fileName: "Meu Hino.slja" });

    expect(mocks.openCustomSong.mock.calls[0][0].nome).toBe("Meu Hino");
  });

  it("lê o arquivo pela URL e tira o nome dela", async () => {
    const blob = await pacote({ nome: "" , slides: [slide({ letra: "" })] });
    mocks.fetchWithTimeout.mockResolvedValue({ ok: true, blob: async () => blob });

    await openSlja("louvorja://local/Users/ana/Hino%20Novo.slja");

    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      "louvorja://local/Users/ana/Hino%20Novo.slja",
      expect.objectContaining({ source: "file" })
    );
    expect(mocks.openCustomSong.mock.calls[0][0].nome).toBe("Hino Novo");
  });

  it("libera as URLs da apresentação anterior só depois de a nova assumir", async () => {
    // A apresentação A pode herdar URLs de testes anteriores (o estado é do
    // módulo); o que importa é o que acontece com as dela ao abrir a B.
    await openSlja(await pacote());
    const urlsDeA = createObjectURL.mock.results.map((r) => r.value);
    revokeObjectURL.mockClear();

    let revogadasQuandoBAssumiu = -1;
    mocks.openCustomSong.mockImplementationOnce(async () => {
      revogadasQuandoBAssumiu = revokeObjectURL.mock.calls.length;
    });
    await openSlja(await pacote());

    expect(revogadasQuandoBAssumiu).toBe(0);
    expect(revokeObjectURL.mock.calls.map((c) => c[0])).toEqual(urlsDeA);
  });

  it("arquivo que não é um pacote vira alerta, não exceção", async () => {
    const ok = await openSlja(new Blob(["isto não é um zip"]), { origin: "system" });

    expect(ok).toBe(false);
    expect(mocks.openCustomSong).not.toHaveBeenCalled();
    expect(mocks.alertError).toHaveBeenCalledWith({
      text: "modules.media.alerts.slja_open_failed",
    });
    expect(mocks.captureException).toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(
      "slja_open_failed",
      expect.objectContaining({ origin: "system" })
    );
  });

  it("pacote sem slides não abre uma projeção vazia", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("slides.lja", "[Geral]\r\nslides=0\r\n");
    const vazio = await zip.generateAsync({ type: "blob" });

    expect(await openSlja(vazio)).toBe(false);
    expect(mocks.openCustomSong).not.toHaveBeenCalled();
    expect(mocks.alertError).toHaveBeenCalled();
  });

  it("arquivo ausente (404) vira alerta", async () => {
    mocks.fetchWithTimeout.mockResolvedValue({ ok: false, status: 404 });

    expect(await openSlja("louvorja://local/Users/ana/sumiu.slja")).toBe(false);
    expect(mocks.alertError).toHaveBeenCalled();
  });
});
