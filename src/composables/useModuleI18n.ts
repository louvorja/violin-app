/**
 * useModuleI18n — Composable padronizado para i18n de módulos.
 *
 * Fornece:
 *  - `t()`  → traduções GLOBAIS (actions.save, shell.title, etc.)
 *  - `tm()` → traduções do MÓDULO (tm("title") → modules.<id>.title)
 *  - `locale` → ref reativo ao idioma atual
 *
 * Uso:
 *   const { t, tm, locale } = useModuleI18n("bible");
 *   t("actions.save")   // global
 *   tm("title")         // modules.bible.title
 */
import { useI18n } from "vue-i18n";

export function useModuleI18n(moduleId: string) {
  const { t, locale } = useI18n();

  const tm = (key: string, named?: Record<string, unknown>): string => {
    const fullKey = `modules.${moduleId}.${key}`;
    return named ? t(fullKey, named) : t(fullKey);
  };

  return { t, tm, locale };
}
