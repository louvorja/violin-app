/**
 * Configuração de fontes disponíveis para seleção na tela de Opções.
 *
 * Cada fonte tem:
 *  - name: nome exibido no select
 *  - family: valor CSS font-family (valor especial abaixo)
 *  - file?: arquivo .ttf/.otf em /assets/fonts/ (opcional)
 *
 * Valores especiais de family:
 *  - "__FONT_DEFAULT_UI__"        → Padrão da Interface configurado em Geral
 *  - "__FONT_DEFAULT_PROJECTION__" → Padrão da Projecão configurado em Geral
 *  - "__DEFAULT__"                → Padrão (resolve para defaultFont prop do SelectFont)
 */

export interface FontOption {
  name: string;
  family: string;
  file?: string;
}

/**
 * A fonte da interface é empacotada, e a mesma nos três sistemas.
 *
 * A alternativa — `system-ui` na frente, deixando cada SO escolher — deixa a
 * interface com cara nativa, mas dá a cada plataforma uma métrica diferente
 * para as mesmas medidas. Esta interface é densa (a escala de corpo vai de 10
 * a 12px) e herdou do Delphi medidas que foram tiradas uma vez só: a folga que
 * cabe uma métrica não cabe a outra. No Linux nem dá para saber qual é — o
 * `system-ui` de lá é Cantarell no GNOME, DejaVu Sans em boa parte das
 * distros, e ambas são bem mais largas que SF Pro e Segoe UI.
 *
 * O valor precisa continuar idêntico ao `--lj-font-shell` de tokens.css: o
 * token pinta o primeiro frame e este valor o substitui logo depois da
 * hidratação do UserData. Enquanto os dois discordaram, todo boot trocava a
 * fonte da interface inteira no meio do caminho.
 */
const UI_STACK =
  '"InterVariable", "Inter", "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", "Tahoma", sans-serif';

/**
 * Stack do sistema, default por um ciclo de versão. Fica reconhecida como
 * legada para que quem a tenha gravada volte ao padrão — ver
 * `_isLegacyUiFallback`.
 */
const UI_SYSTEM_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** Defaults concretos, marcadores persistidos e variáveis CSS do sistema. */
export const FONT = {
  DEFAULT: "__DEFAULT__",
  UI: {
    FALLBACK: UI_STACK,
    INHERIT: "__FONT_DEFAULT_UI__",
    CSS_VAR: "--lj-font-shell",
  },
  PROJECTION: {
    FALLBACK: "DINCondensedBold",
    INHERIT: "__FONT_DEFAULT_PROJECTION__",
    CSS_VAR: "--lj-font-projection",
  },
} as const;

/** Marcador aceito apenas para dados persistidos por versões antigas. */
const LEGACY_UI_FAMILY = "__UI_FONT__";

/** Lista de fontes disponíveis para seleção. */
export const Fonts: FontOption[] = [
  { name: "Padrão da Interface", family: FONT.UI.INHERIT },
  { name: "Padrão da Projecão", family: FONT.PROJECTION.INHERIT },
  { name: "Advent Sans", family: "AdventSansLogo", file: "AdventSans-Logo.woff2" },
  { name: "Arial", family: "Arial, sans-serif" },
  { name: "Aventureiros", family: "InterVariable", file: "Inter-VariableFont_opsz,wght.woff2" },
  { name: "Calibri Bold", family: "CalibriBold", file: "calibri-bold.woff2" },
  { name: "Desbravadores", family: "ImpactRegular", file: "impact-regular-6_ufonts.com.woff2" },
  { name: "DIN Condensed Bold", family: "DINCondensedBold", file: "din-condensed-bold.woff2" },
  { name: "Fjalla One", family: "FjallaOne", file: "FjallaOne-Regular.woff2" },
  { name: "Georgia", family: "Georgia, serif" },
  { name: "Helvetica", family: "Helvetica, sans-serif" },
  { name: "Ministério da Criança", family: "BetaniaPatmos", file: "BetaniaPatmos-Regular.woff2" },
  { name: "Ministério Jovem", family: "MinisterioJovem", file: "FjallaOne-Regular.woff2" },
  { name: "Open Sans", family: "OpenSans", file: "OpenSans-Regular.woff2" },
  { name: "Open Sans Extra Bold", family: "OpenSansExtraBold", file: "OpenSans-ExtraBold.woff2" },
  { name: "Open Sans Light", family: "OpenSansLight", file: "OpenSans-Light.woff2" },
  { name: "Open Sans Semi Bold", family: "OpenSansSemiBold", file: "OpenSans-Semibold.woff2" },
  { name: "Roboto", family: "RobotoVariable", file: "Roboto-VariableFont_wdth,wght.woff2" },
  { name: "Tahoma", family: "Tahoma, sans-serif" },
  { name: "Times New Roman", family: "'Times New Roman', serif" },
  { name: "Verdana", family: "Verdana, sans-serif" },
];

/**
 * Um valor gravado por versão anterior como se fosse escolha do usuário.
 * `seedDefaultFonts` semeia a stack padrão literalmente em `options.font`, e
 * cada vez que esse padrão muda o valor antigo fica no disco. Sem reconhecê-lo
 * aqui, quem já abriu o app uma vez nunca veria o padrão novo — foi o que
 * prendeu os usuários na Inter quando o default virou a fonte do sistema, e o
 * que prenderia o Linux em `system-ui` agora.
 */
function _isLegacyUiFallback(saved: string): boolean {
  return saved === LEGACY_UI_FAMILY || saved === UI_SYSTEM_STACK;
}

/**
 * Resolve o valor CSS font-family a partir da chave salva no UserData.
 *
 * Valores especiais:
 *  - "__FONT_DEFAULT_UI__"         → variável global da fonte de interface
 *  - "__FONT_DEFAULT_PROJECTION__" → variável global da fonte de projeção
 *  - "__DEFAULT__"                  → defaultFont (passado como parâmetro)
 *  - qualquer outro valor          → retornado diretamente (CSS font-family)
 */
export function resolveFont(
  saved: string | null | undefined,
  fallback: string,
  defaultFont?: string
): string {
  if (typeof saved !== "string" || !saved.trim()) return fallback;
  if (saved === FONT.UI.INHERIT || _isLegacyUiFallback(saved)) {
    return `var(${FONT.UI.CSS_VAR}, ${FONT.UI.FALLBACK})`;
  }
  if (saved === FONT.PROJECTION.INHERIT) {
    return `var(${FONT.PROJECTION.CSS_VAR}, ${FONT.PROJECTION.FALLBACK})`;
  }
  if (saved === FONT.DEFAULT) return defaultFont || fallback;
  return saved;
}

/** Resolve os selects de Geral, que precisam produzir uma família concreta. */
export function resolveDefaultFont(saved: string | null | undefined, fallback: string): string {
  if (typeof saved !== "string" || !saved.trim()) return fallback;
  if (
    saved === FONT.DEFAULT ||
    saved === FONT.UI.INHERIT ||
    saved === FONT.PROJECTION.INHERIT ||
    _isLegacyUiFallback(saved)
  ) {
    return fallback;
  }
  return saved;
}
