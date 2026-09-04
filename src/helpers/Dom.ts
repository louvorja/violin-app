export function scrollToElement(el: Element | null | undefined, opts: ScrollIntoViewOptions = {}): void {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "nearest", ...opts });
}

/**
 * Desanexa a fonte de um <audio>/<video> sem disparar um novo carregamento.
 *
 * `el.src = ""` NÃO limpa a fonte: o navegador resolve a string vazia contra a
 * URL do documento e tenta carregar o próprio HTML como mídia, falhando com
 * `NotSupportedError: Failed to load because no supported source was found.`
 * — e deixando `el.src` truthy (a URL da página), o que quebra checagens de
 * "tem áudio carregado?".
 */
export function detachMediaSource(el: HTMLMediaElement): void {
  el.removeAttribute("src");
  el.load();
}
