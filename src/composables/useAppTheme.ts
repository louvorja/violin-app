/**
 * Tema visual do app — leitura, troca e sincronização.
 *
 * Trocar de tema tem três efeitos que precisam andar juntos, e cada tela que
 * fazia isso na mão esquecia um deles:
 *   1. `[data-theme]` no `<html>` — é o que ativa os tokens em tokens.css,
 *      inclusive para conteúdo teleportado (menus, diálogos);
 *   2. `options.theme` no UserData — o que sobrevive ao restart;
 *   3. `is_dark` no AppData — lido por telas que só querem saber o modo.
 *
 * Duas coisas diferentes atendem por "tema": a *preferência* guardada em
 * `options.theme` (um tema, ou "auto") e o tema *em uso* que vai para o
 * `<html>`. Só no modo Automático elas diferem: o em uso é `dark` quando o
 * sistema está escuro e o último tema claro quando está claro. O `<html>` nunca
 * recebe "auto" — tokens.css não tem esse bloco.
 *
 * Todo o estado vem dos stores e do modo do sistema (ambos reativos), então
 * não há cache local aqui: chamar o composable em qualquer janela devolve o
 * mesmo tema, já reativo a patches vindos de outra janela e à virada do
 * sistema. Quem carimba `[data-theme]` nas janelas que não chamaram `setTheme`
 * é `startThemeSync`, chamado no bootstrap de cada uma — sem ele a projeção
 * ficaria com a paleta antiga enquanto o valor do tema já era o novo.
 */

import { computed, watch, type ComputedRef, type WatchStopHandle } from "vue";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { useSystemColorScheme } from "@/composables/useSystemColorScheme";
import {
  AUTO_THEME_ID,
  DARK_THEME_ID,
  DEFAULT_THEME_PREFERENCE,
  getTheme,
  isThemePreference,
  pickLightTheme,
  resolveTheme,
  type ThemeId,
  type ThemePreference,
} from "@/config/Themes";

interface AppThemeAPI {
  /** O que o usuário escolheu, já validado: um tema ou "auto". */
  preference: ComputedRef<ThemePreference>;
  /** Tema em uso de verdade — no Automático, já resolvido contra o sistema. */
  current: ComputedRef<ThemeId>;
  /** Tema claro para onde o Automático e o botão de alternar voltam. */
  lightTheme: ComputedRef<ThemeId>;
  isDark: ComputedRef<boolean>;
  setTheme: (preference: ThemePreference) => void;
  /**
   * Alterna entre o tema escuro e o último claro em uso. É uma escolha
   * explícita: quem estava no Automático sai dele e fica no tema escolhido.
   */
  toggleDark: () => void;
  /** Aplica o tema em uso ao documento, sem regravar a preferência. */
  applyStoredTheme: () => ThemeId;
  /** Carimba um tema só no documento — para telas de demonstração. */
  previewTheme: (id: ThemeId) => void;
}

function readPreference(): ThemePreference {
  const stored = $userdata.get<string>(KEYS.OPTIONS.THEME);
  return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
}

function readLastLight(): unknown {
  return $userdata.get<string>(KEYS.OPTIONS.THEME_LAST_LIGHT);
}

function stamp(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}

export function useAppTheme(): AppThemeAPI {
  const systemDark = useSystemColorScheme();

  const preference = computed<ThemePreference>(() => readPreference());
  const lightTheme = computed<ThemeId>(() => pickLightTheme(readLastLight()));
  const current = computed<ThemeId>(() =>
    resolveTheme(preference.value, systemDark.value, readLastLight())
  );
  const isDark = computed<boolean>(() => getTheme(current.value).dark);

  function applyStoredTheme(): ThemeId {
    const id = current.value;
    stamp(id);
    $appdata.set(KEYS.SHELL.IS_DARK, getTheme(id).dark);
    return id;
  }

  function setTheme(id: ThemePreference): void {
    if (id === AUTO_THEME_ID) {
      $userdata.set(KEYS.OPTIONS.THEME, AUTO_THEME_ID);
      applyStoredTheme();
      return;
    }

    // `theme.id`, não `id`: getTheme já saneia um valor fora do registro, e
    // gravar o cru deixaria o documento carimbado com algo que nenhum bloco
    // [data-theme] casa — a paleta cai no default de :root e o estado
    // inconsistente sobrevive ao restart.
    const theme = getTheme(id);
    $userdata.set(KEYS.OPTIONS.THEME, theme.id);
    if (!theme.dark) $userdata.set(KEYS.OPTIONS.THEME_LAST_LIGHT, theme.id);
    applyStoredTheme();
  }

  function toggleDark(): void {
    if (!isDark.value) {
      // Guardar aqui, e não só no setTheme: um perfil cujo tema foi escrito por
      // um caminho antigo não tem THEME_LAST_LIGHT nenhum, e sem isto o
      // primeiro retorno do escuro cairia no tema padrão em vez do dele.
      $userdata.set(KEYS.OPTIONS.THEME_LAST_LIGHT, current.value);
      setTheme(DARK_THEME_ID);
      return;
    }
    setTheme(lightTheme.value);
  }

  function previewTheme(id: ThemeId): void {
    stamp(id);
  }

  return {
    preference,
    current,
    lightTheme,
    isDark,
    setTheme,
    toggleDark,
    applyStoredTheme,
    previewTheme,
  };
}

/**
 * Mantém o `<html>` e o `is_dark` da janela em dia com o tema em uso. Uma
 * chamada por janela, no bootstrap: cobre o que `setTheme` sozinho não alcança
 * — o patch do UserData que vem de outra janela e a virada do sistema entre
 * claro e escuro no modo Automático.
 */
export function startThemeSync(): WatchStopHandle {
  const { current, applyStoredTheme } = useAppTheme();
  return watch(current, () => applyStoredTheme(), { immediate: true });
}
