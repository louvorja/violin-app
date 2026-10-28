/**
 * Texto principal de um slide, igual em todas as telas (projeção, retorno, OBS,
 * operador e controle remoto).
 *
 * O nome (título da música ou item da Liturgia) só substitui a letra na capa.
 * Fora dela, slide sem letra é proposital — trecho instrumental, fim da música
 * com só a imagem — e mostrar o nome ali parecia parte da letra (issue #15).
 */
export function slideMainText(
  slide: { lyric?: unknown; name?: unknown; cover?: unknown } | null | undefined
): string {
  if (!slide) return "";
  if (typeof slide.lyric === "string" && slide.lyric) return slide.lyric;
  return slide.cover === true && typeof slide.name === "string" ? slide.name : "";
}
