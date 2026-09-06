import { createI18n } from "vue-i18n";

const IDIOMAS = ["pt", "es"];
const PADRAO = "pt";

const carregar = (locale) => import(`./lang/${locale}.json`);

/**
 * @param {string} [localeInicial] idioma salvo em UserData; cai no padrão se
 *   vier vazio ou desconhecido.
 */
export const createI18nInstance = async (localeInicial) => {
  const locale = IDIOMAS.includes(localeInicial) ? localeInicial : PADRAO;

  // Só o que a primeira tela precisa trava o boot. Antes os dois idiomas eram
  // buscados em série antes do mount, e um deles — 40KB — nunca seria lido
  // naquela sessão. O padrão entra junto quando não é o idioma escolhido,
  // porque é ele que cobre chave faltando na tradução.
  const necessarios = locale === PADRAO ? [PADRAO] : [locale, PADRAO];
  const carregados = await Promise.all(necessarios.map(carregar));

  const messages = {};
  necessarios.forEach((l, i) => {
    messages[l] = carregados[i];
  });

  const i18n = createI18n({
    legacy: false, // Usando a API Composition
    locale,
    fallbackLocale: PADRAO,
    messages,
  });

  // Os demais chegam depois do mount: existem para a troca em "Opções", que é
  // manual e nunca acontece nos primeiros instantes do app.
  for (const outro of IDIOMAS) {
    if (necessarios.includes(outro)) continue;
    carregar(outro)
      .then((m) => i18n.global.setLocaleMessage(outro, m))
      .catch((e) => console.warn(`[i18n] idioma "${outro}" não carregou:`, e));
  }

  return i18n;
};

export default createI18nInstance;
