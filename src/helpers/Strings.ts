/** @category helper-puro — Limpeza e ordenação de strings UTF-8. Sem APIs Vue; sem acesso ao store. */
export default {
  clean(text: string): string {
    text = text || "";

    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  },
  /**
   * Minúsculas sem acento, preservando espaços e pontuação leve.
   *
   * `clean` existe para comparação por trecho e por isso descarta tudo que não
   * é alfanumérico — inclusive os espaços, o que colaria "santo santo" em
   * "santosanto". A busca difusa precisa das fronteiras entre palavras para
   * pontuar a similaridade, então normaliza por aqui.
   */
  fold(text: string): string {
    return (text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  },
  /**
   * Escapa texto digitado pelo usuário antes de injetá-lo em HTML. O Alert
   * renderiza título e texto com v-html, então um nome como `<img onerror=…>`
   * viraria marcação de verdade dentro da confirmação.
   */
  escapeHtml(text: string): string {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },
  sort(a: string | number, b: string | number): number {
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }

    const strA = String(a || "");
    const strB = String(b || "");

    return strA
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .localeCompare(
        strB
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
      );
  },
};
