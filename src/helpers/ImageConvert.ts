/**
 * ImageConvert.ts — fronteira de importação de imagem: o que o Chromium
 * consegue desenhar entra, o que não consegue é recusado com uma explicação.
 *
 * HEIC/HEIF (fotos de iPhone) fica de fora. Converter exigia libheif, que é
 * Emscripten e monta código com `new Function` — para funcionar o app teria de
 * abrir `'unsafe-eval'` no `script-src`, e esse afrouxamento valeria para todas
 * as telas, não só para a importação de fotos. Em produção o CSP nunca
 * permitiu, então a conversão só funcionava em desenvolvimento, onde o CSP do
 * Electron acrescenta `'unsafe-eval'` (`electron/main/csp.js`) — na mão do
 * operador ela falhava com um erro de console e nada na tela.
 *
 * @category deve-virar-composable — Avisa pelo Snackbar (Pinia); requer renderer.
 */
import $snackbar from "@/helpers/Snackbar";
import { i18nAtual } from "@/i18n";

/** Detecta HEIC/HEIF pela extensão do nome ou pelo mime. */
export function isHeic(name?: string | null, mime?: string | null): boolean {
  if (mime && /^image\/hei[cf]$/i.test(mime)) return true;
  if (!name) return false;
  return /\.(heic|heif)$/i.test(name);
}

/** Erro de formato recusado, para o chamador distinguir de falha de leitura. */
export class FormatoNaoSuportadoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatoNaoSuportadoError";
  }
}

function avisarHeic(): string {
  const t = i18nAtual()?.global?.t;
  const texto = t ? t("messages.heic_nao_suportado") : "Converta a foto para JPEG antes de importar.";
  $snackbar.warning(texto, { timeout: 6000 });
  return texto;
}

/**
 * Mantida para os chamadores que já sabiam separar HEIC do resto: hoje só
 * avisa e recusa.
 */
export async function heicToJpeg(_source: Blob): Promise<Blob> {
  throw new FormatoNaoSuportadoError(avisarHeic());
}

/**
 * Garante uma imagem renderizável. Devolve os dados originais quando o formato
 * serve, e recusa HEIC/HEIF avisando o operador.
 *
 * @param name   Nome do arquivo (ex.: "IMG_0001.heic").
 * @param source Blob com os bytes da imagem.
 * @returns { blob, name } prontos para importação/registro.
 */
export async function ensureRenderableImage(
  name: string,
  source: Blob
): Promise<{ blob: Blob; name: string }> {
  if (!isHeic(name, source.type)) return { blob: source, name };
  throw new FormatoNaoSuportadoError(avisarHeic());
}

export default { isHeic, heicToJpeg, ensureRenderableImage, FormatoNaoSuportadoError };
