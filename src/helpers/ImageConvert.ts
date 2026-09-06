/**
 * ImageConvert.ts — fronteira de importação de imagem: converte para JPEG o
 * que o Chromium não decodifica (HEIC/HEIF, as fotos de iPhone), para que
 * miniatura, prévia e projeção funcionem.
 *
 * A biblioteca é a variante `heic-to/csp`, e a escolha não é cosmética: o build
 * padrão do libheif é Emscripten e monta código com `new Function`, o que só
 * roda sob `'unsafe-eval'`. Abrir isso no `script-src` valeria para o app
 * inteiro por causa da importação de fotos. A variante `csp` é compilada sem
 * execução dinâmica e se contenta com o `'wasm-unsafe-eval'` que o CSP já tem.
 *
 * O import é dinâmico porque a biblioteca é grande e cria workers ao ser
 * avaliada. Estática, esse custo caía sobre toda tela que só queria saber se um
 * arquivo é HEIC — pergunta que `isHeic` responde com uma expressão regular.
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

/** Recusa o arquivo explicando o porquê — a conversão não é garantida. */
function recusarHeic(): never {
  const t = i18nAtual()?.global?.t;
  const texto = t
    ? t("messages.heic_nao_suportado")
    : "Converta a foto para JPEG antes de importar.";
  $snackbar.warning(texto, { timeout: 6000 });
  throw new FormatoNaoSuportadoError(texto);
}

/**
 * Converte um blob HEIC/HEIF para JPEG (quality 0.92).
 * Avisa e rejeita se a conversão falhar — o chamador não recebe bytes que a
 * tela não conseguiria desenhar.
 */
export async function heicToJpeg(source: Blob): Promise<Blob> {
  try {
    const { heicTo } = await import("heic-to/csp");
    return await heicTo({ blob: source, type: "image/jpeg", quality: 0.92 });
  } catch (e) {
    if (e instanceof FormatoNaoSuportadoError) throw e;
    console.warn("[ImageConvert] conversão de HEIC falhou:", e);
    recusarHeic();
  }
}

/**
 * Garante uma imagem renderizável: se o arquivo for HEIC/HEIF, converte para
 * JPEG e ajusta a extensão do nome. Caso contrário devolve os dados originais.
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
  const converted = await heicToJpeg(source);
  const base = name.replace(/\.(heic|heif)$/i, "");
  return { blob: converted, name: `${base}.jpg` };
}

export default { isHeic, heicToJpeg, ensureRenderableImage, FormatoNaoSuportadoError };
