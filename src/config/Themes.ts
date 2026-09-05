/**
 * Registro dos temas visuais do app.
 *
 * O tema de verdade são os tokens `--lj-*` pendurados em `[data-theme="<id>"]`
 * no arquivo src/assets/styles/tokens.css — este registro só descreve o que o
 * JavaScript precisa saber sobre eles: o id carimbado no `<html>`, se o tema
 * pinta as superfícies escuras e a cor que o representa nas amostras.
 *
 * Ao criar ou remover um tema aqui, criar ou remover também o bloco
 * `[data-theme="<id>"]` correspondente em tokens.css.
 */

export interface AppTheme {
  /** Carimbado em `[data-theme]` no `<html>` e persistido em `options.theme`. */
  id: string;
  /**
   * Superfícies escuras. Só `dark` as tem: os demais (inclusive `black`)
   * trocam apenas a paleta de marca `--lj-navy*`, mantendo o corpo claro.
   */
  dark: boolean;
  /** Cor da amostra — é o `--lj-navy` do bloco do tema em tokens.css. */
  swatch: string;
}

export const APP_THEMES = [
  { id: "light", dark: false, swatch: "#29569b" },
  { id: "dark", dark: true, swatch: "#2e2e2e" },
  { id: "black", dark: false, swatch: "#2e2e2e" },
  { id: "blue", dark: false, swatch: "#0b3d62" },
  { id: "darkblue", dark: false, swatch: "#1b2a41" },
  { id: "green", dark: false, swatch: "#077568" },
  { id: "orange", dark: false, swatch: "#d24726" },
  { id: "purple", dark: false, swatch: "#80397b" },
  { id: "pink", dark: false, swatch: "#e91e63" },
  { id: "terracota", dark: false, swatch: "#722f37" },
] as const satisfies readonly AppTheme[];

export type ThemeId = (typeof APP_THEMES)[number]["id"];

export const THEME_IDS: readonly ThemeId[] = APP_THEMES.map((theme) => theme.id);

export const DEFAULT_THEME_ID: ThemeId = "darkblue";

/** Destino do botão de alternar claro/escuro. */
export const DARK_THEME_ID: ThemeId = "dark";

const BY_ID = new Map<string, AppTheme>(APP_THEMES.map((theme) => [theme.id, theme]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && BY_ID.has(value);
}

/** Um id fora da lista cai no tema padrão em vez de deixar a tela sem tokens. */
export function getTheme(id: string): AppTheme {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_THEME_ID) as AppTheme);
}

export function isDarkTheme(id: string): boolean {
  return getTheme(id).dark;
}

export const LIGHT_THEMES: readonly AppTheme[] = APP_THEMES.filter((theme) => !theme.dark);

export const DARK_THEMES: readonly AppTheme[] = APP_THEMES.filter((theme) => theme.dark);
