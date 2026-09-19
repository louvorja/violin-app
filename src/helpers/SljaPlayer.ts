/**
 * SljaPlayer.ts — Apresenta um arquivo .slja dentro do app.
 *
 * Um .slja é uma apresentação (slides, áudio e imagens) no formato do LouvorJA
 * clássico. Entregue ao sistema operacional (`shell.openPath`), ele abriria no
 * programa associado — no Windows, o aplicativo antigo. Por isso tudo o que o
 * app "abre" (item de liturgia, item agendado, controle remoto, duplo clique no
 * arquivo) passa por aqui e toca na projeção como qualquer música.
 *
 * Nada é gravado: o pacote vive em blob: URLs até a próxima apresentação. Quem
 * quer o arquivo nas Coletâneas importa pelo módulo próprio.
 *
 * @category deve-virar-composable — Usa useMedia (Pinia) e Alert; requer renderer.
 */
import SljaConverter from "@/helpers/SljaConverter";
import $media from "@/composables/useMedia";
import $alert from "@/helpers/Alert";
import Telemetry from "@/helpers/Telemetry";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";

export const SLJA_EXT = "slja";

export interface OpenSljaOptions {
  /** Título da apresentação; sem ele vale o nome gravado no pacote. */
  title?: string;
  /** Nome do arquivo, quando `source` é uma URL ou um Blob sem nome. */
  fileName?: string;
  /** Quem pediu (liturgy, remote, system), para a telemetria. */
  origin?: string;
}

/** URLs da apresentação em cena; liberadas quando a próxima assume a projeção. */
let liveUrls: string[] = [];

function baseName(value: string): string {
  const last = value.split(/[\\/]/).pop() || "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

async function readBlob(source: Blob | string): Promise<Blob> {
  if (typeof source !== "string") return source;
  const response = await fetchWithTimeout(source, {
    timeout: NET_TIMEOUT.MEDIA,
    source: "file",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

/**
 * Abre o .slja na projeção do app. Erros viram um alerta para o operador —
 * nunca uma exceção para o chamador, que está no meio de um culto.
 *
 * @param source  URL do arquivo (`louvorja://local/...`, http) ou o próprio Blob/File.
 * @returns `true` se a apresentação foi aberta.
 */
export async function openSlja(
  source: Blob | string,
  options: OpenSljaOptions = {}
): Promise<boolean> {
  const fileName =
    options.fileName ||
    (typeof source === "string" ? baseName(source) : (source as File).name || "");

  try {
    const data = await SljaConverter.loadSlja(await readBlob(source));
    if (!data.slides.length) throw new Error("slja sem slides");
    SljaConverter.fillMissingImages(data.slides);

    const urls: string[] = [];
    const urlFor = (blob: Blob): string => {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return url;
    };

    // O pacote grava `imagens/foto.png`, mas o mapa vem chaveado só pelo que
    // segue a pasta — e nem todo autor escreve o INI do mesmo jeito. Resolve
    // pelos dois nomes, como a importação das Coletâneas.
    const imageUrls = new Map<string, string>();
    for (const [imagePath, blob] of data.images) {
      const url = urlFor(blob);
      imageUrls.set(imagePath, url);
      imageUrls.set(baseName(imagePath), url);
    }

    const song = {
      nome: options.title?.trim() || SljaConverter.resolveSongName(data, fileName),
      audio_token: data.audio ? urlFor(data.audio) : "",
      audio_name: data.audioName || "",
      slides: data.slides.map((slide: { imagem?: string }) => ({
        ...slide,
        imagem: slide.imagem
          ? (imageUrls.get(slide.imagem) ?? imageUrls.get(baseName(slide.imagem)) ?? "")
          : "",
      })),
    };

    // As URLs anteriores só saem depois que os novos slides assumiram a
    // projeção; revogá-las antes deixaria o fundo do slide em cena sem imagem.
    const previous = liveUrls;
    liveUrls = urls;
    try {
      await $media.openCustomSong(song);
    } finally {
      previous.forEach((url) => URL.revokeObjectURL(url));
    }
    return true;
  } catch (error) {
    Telemetry.captureException(error, { source: "slja.open", origin: options.origin });
    Telemetry.track("slja_open_failed", {
      origin: options.origin,
      reason: error instanceof Error ? error.message : "unknown",
    });
    console.warn("[SljaPlayer] não foi possível abrir o .slja:", fileName, error);
    $alert.error({ text: "modules.media.alerts.slja_open_failed" });
    return false;
  }
}
