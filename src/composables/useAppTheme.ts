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
 * Todo o estado vem dos stores, então não há cache local aqui: chamar o
 * composable em qualquer janela devolve o mesmo tema, já reativo a patches
 * vindos de outra janela.
 */

import { computed, type ComputedRef } from "vue";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import {
  DARK_THEME_ID,
  DEFAULT_THEME_ID,
  getTheme,
  isThemeId,
  type ThemeId,
} from "@/config/Themes";

interface AppThemeAPI {
  /** Tema em uso, já validado contra o registro. */
  current: ComputedRef<ThemeId>;
  isDark: ComputedRef<boolean>;
  setTheme: (id: ThemeId) => void;
  /** Alterna entre o tema escuro e o último claro em uso. */
  toggleDark: () => void;
  /** Aplica no boot o tema persistido, sem regravá-lo. */
  applyStoredTheme: () => ThemeId;
  /** Carimba um tema só no documento — para telas de demonstração. */
  previewTheme: (id: ThemeId) => void;
}

function readStoredTheme(): ThemeId {
  const stored = $userdata.get<string>(KEYS.OPTIONS.THEME);
  return isThemeId(stored) ? stored : DEFAULT_THEME_ID;
}

function stamp(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}

export function useAppTheme(): AppThemeAPI {
  const current = computed<ThemeId>(() => readStoredTheme());
  const isDark = computed<boolean>(() => getTheme(current.value).dark);

  function setTheme(id: ThemeId): void {
    const theme = getTheme(id);
    $userdata.set(KEYS.OPTIONS.THEME, id);
    if (!theme.dark) $userdata.set(KEYS.OPTIONS.THEME_LAST_LIGHT, id);
    stamp(id);
    $appdata.set(KEYS.SHELL.IS_DARK, theme.dark);
  }

  function toggleDark(): void {
    if (!isDark.value) {
      setTheme(DARK_THEME_ID);
      return;
    }
    const last = $userdata.get<string>(KEYS.OPTIONS.THEME_LAST_LIGHT);
    setTheme(isThemeId(last) && !getTheme(last).dark ? last : DEFAULT_THEME_ID);
  }

  function applyStoredTheme(): ThemeId {
    const id = current.value;
    stamp(id);
    $appdata.set(KEYS.SHELL.IS_DARK, getTheme(id).dark);
    return id;
  }

  function previewTheme(id: ThemeId): void {
    stamp(id);
  }

  return { current, isDark, setTheme, toggleDark, applyStoredTheme, previewTheme };
}
