/**
 * Estilo de fundo a partir da opção "Ajuste" escolhida pelo usuário.
 *
 * O mesmo mapa estava copiado em quatro views de projeção. Além da duplicação,
 * a prévia da tela de Opções não usava nenhuma delas: desenhava um <img> com
 * `object-fit: contain` fixo, então mostrava sempre "Ajustar" enquanto a
 * projeção aplicava cover, ladrilho ou esticado.
 *
 * @category helper-puro
 */

/** Valores de `background-size` por opção de ajuste. */
const TAMANHO: Record<string, string> = {
  cover: "cover",
  contain: "contain",
  center: "auto",
  stretch: "100% 100%",
  tile: "auto",
};

const REPETICAO: Record<string, string> = { tile: "repeat" };

/** As duas opções cujo tamanho é o natural da imagem, e por isso dependem da escala. */
const DEPENDE_DA_ESCALA = new Set(["center", "tile"]);

export interface FundoParams {
  color: string;
  imageUrl?: string | null;
  position?: string | null;
  /**
   * Só para miniaturas. `center` e `tile` desenham a imagem em tamanho natural:
   * numa caixa de 280px, uma imagem de 1920px apareceria gigante e cortada, e o
   * ladrilho mostraria menos de um bloco onde o telão mostra vários. Com a
   * escala (largura da caixa ÷ largura do monitor) a miniatura passa a
   * representar o que vai ao telão.
   */
  escala?: number;
  /** Largura natural da imagem, necessária apenas quando `escala` é passada. */
  larguraNatural?: number;
}

export function estiloDeFundo(p: FundoParams): Record<string, string> {
  const style: Record<string, string> = { background: p.color };
  if (!p.imageUrl) return style;

  const pos = p.position || "cover";
  style.backgroundImage = `url(${p.imageUrl})`;
  style.backgroundPosition = pos === "tile" ? "0 0" : "center";
  style.backgroundRepeat = REPETICAO[pos] || "no-repeat";

  const escalar =
    p.escala !== undefined && p.larguraNatural !== undefined && DEPENDE_DA_ESCALA.has(pos);
  style.backgroundSize = escalar
    ? `${Math.max(1, Math.round(p.larguraNatural! * p.escala!))}px auto`
    : TAMANHO[pos] || "cover";

  return style;
}
