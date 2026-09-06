import { useI18n } from "vue-i18n";
import { module } from "./manifest";

const PREFIXO = `modules.${module.id}.`;

/**
 * `t` do módulo — resolve contra `modules.liturgy.*` na instância única do
 * vue-i18n, a mesma onde o ModuleManager funde o `lang/` do módulo em boot.
 *
 * Existe porque cada arquivo daqui importava `lang/pt.json` e `lang/es.json`
 * direto e reimplementava a busca por caminho: treze cópias do mesmo resolvedor,
 * os dois idiomas inteiros duplicados no bundle, e nenhuma delas enxergando o
 * fallback nem a interpolação do vue-i18n. Chave ausente saía na tela como o
 * próprio caminho, sem erro no console — foi assim que o seletor de dia do
 * "Gerenciar liturgia" exibiu `library.weekday_sunday` no lugar de "Domingo".
 */
export function useLiturgyI18n() {
  const { t, locale } = useI18n();

  return {
    t: (chave: string, valores?: Record<string, unknown>): string =>
      valores ? t(PREFIXO + chave, valores) : t(PREFIXO + chave),
    /** Chaves compartilhadas do app (`actions.*`, `alert.*`) — sem prefixo. */
    tGlobal: t,
    locale,
  };
}

/**
 * Caminho completo de uma chave do módulo, para quem traduz por conta própria.
 * O `$alert` recebe a chave e traduz na hora de pintar — passar texto já
 * traduzido faria o `$t` do diálogo reprocessá-lo, e aí `{`, `}` e `@:` num
 * nome escrito pelo operador viram sintaxe de mensagem do vue-i18n.
 */
export function chaveLiturgia(chave: string): string {
  return PREFIXO + chave;
}
