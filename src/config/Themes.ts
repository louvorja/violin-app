/**
 * Registro dos temas visuais do app.
 *
 * O tema de verdade são os tokens `--lj-*` pendurados em `[data-theme="<id>"]`
 * no arquivo src/assets/styles/tokens.css — este registro só descreve o que o
 * JavaScript precisa saber sobre eles: o id carimbado no `<html>` e se o tema
 * pinta as superfícies escuras.
 *
 * A cor de cada tema NÃO entra aqui de propósito. Ela já existe como `--lj-navy`
 * dentro do bloco do tema, e copiá-la para cá criaria uma terceira cópia da
 * paleta que nada mantém em dia: bastaria alguém ajustar tokens.css para o
 * usuário clicar numa cor e a interface pintar outra. Quem desenha uma amostra
 * carimba `data-theme` no próprio elemento e lê `var(--lj-navy)` dali.
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
}

export const APP_THEMES = [
  { id: "light", dark: false },
  { id: "dark", dark: true },
  { id: "black", dark: false },
  { id: "blue", dark: false },
  { id: "darkblue", dark: false },
  { id: "green", dark: false },
  { id: "orange", dark: false },
  { id: "purple", dark: false },
  { id: "pink", dark: false },
  { id: "terracota", dark: false },
] as const satisfies readonly AppTheme[];

export type ThemeId = (typeof APP_THEMES)[number]["id"];

export const THEME_IDS: readonly ThemeId[] = APP_THEMES.map((theme) => theme.id);

export const DEFAULT_THEME_ID: ThemeId = "darkblue";

/** Destino do botão de alternar claro/escuro. */
export const DARK_THEME_ID: ThemeId = "dark";

/**
 * "Automático" não é um tema: não tem bloco em tokens.css e nunca é carimbado
 * no `<html>`. É uma preferência que se resolve em um tema de verdade a cada
 * troca de modo do sistema — escuro vira `dark`, claro volta ao último tema
 * claro que o usuário escolheu.
 */
export const AUTO_THEME_ID = "auto";

export type ThemePreference = ThemeId | typeof AUTO_THEME_ID;

/** Quem nunca escolheu um tema acompanha o sistema. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = AUTO_THEME_ID;

/** O elemento literal do registro: o `id` aqui é `ThemeId`, não `string`. */
type AppThemeEntry = (typeof APP_THEMES)[number];

const BY_ID = new Map<string, AppThemeEntry>(APP_THEMES.map((theme) => [theme.id, theme]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && BY_ID.has(value);
}

/** Um id fora da lista cai no tema padrão em vez de deixar a tela sem tokens. */
export function getTheme(id: string): AppThemeEntry {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_THEME_ID) as AppThemeEntry);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === AUTO_THEME_ID || isThemeId(value);
}

export function isDarkTheme(id: string): boolean {
  return getTheme(id).dark;
}

/**
 * O tema claro para onde o app volta ao sair do escuro: o último em uso, ou o
 * padrão quando nenhum foi guardado (ou o guardado não existe mais). É a mesma
 * regra para o botão de alternar e para o modo Automático — duas versões dela
 * divergiriam na primeira vez que alguém mexesse numa só.
 */
export function pickLightTheme(lastLight: unknown): ThemeId {
  return isThemeId(lastLight) && !getTheme(lastLight).dark ? lastLight : DEFAULT_THEME_ID;
}

/** Tema de verdade para uma preferência, dado o modo atual do sistema. */
export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
  lastLight: unknown
): ThemeId {
  if (preference !== AUTO_THEME_ID) return preference;
  return systemDark ? DARK_THEME_ID : pickLightTheme(lastLight);
}

export const LIGHT_THEMES: readonly AppTheme[] = APP_THEMES.filter((theme) => !theme.dark);

export const DARK_THEMES: readonly AppTheme[] = APP_THEMES.filter((theme) => theme.dark);
