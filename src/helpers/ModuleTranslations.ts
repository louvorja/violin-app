import Telemetry from "@/helpers/Telemetry";

type I18nLike = {
  global: {
    fallbackLocale: { value: unknown };
    mergeLocaleMessage(_locale: string, _message: Record<string, unknown>): void;
    setMissingHandler(
      _handler: (_locale: string, _key: string) => void
    ): void;
  };
};

type TranslationModule = { default?: unknown } | Record<string, unknown>;
type TranslationLoader = () => Promise<TranslationModule>;

// O mapa contém apenas loaders. Nenhum JSON ou manifesto de módulo entra no
// bootstrap auxiliar até uma chave `modules.<id>.*` ser realmente solicitada.
const translationLoaders = import.meta.glob<TranslationModule>("../modules/*/lang/*.json");
const translationPromises = new Map<string, Promise<void>>();
const translationsLoaded = new Set<string>();

let boundI18n: I18nLike | null = null;

export function bindModuleI18n(i18n: I18nLike): void {
  boundI18n = i18n;
  i18n.global.setMissingHandler((locale, key) => {
    const moduleId = /^modules\.([^.]+)\./.exec(key)?.[1];
    if (moduleId && !translationsLoaded.has(moduleId)) {
      void ensureModuleTranslations(moduleId);
      return;
    }
    if (import.meta.env.DEV && locale === i18n.global.fallbackLocale.value) {
      console.warn(`[i18n] chave ausente "${key}"`);
    }
  });
}

export function ensureModuleTranslations(moduleId: string): Promise<void> {
  if (!boundI18n) return Promise.resolve();
  const pending = translationPromises.get(moduleId);
  if (pending) return pending;

  const promise = Promise.all(
    ["pt", "es"].map(async (locale) => {
      const path = `../modules/${moduleId}/lang/${locale}.json`;
      const loader = translationLoaders[path] as TranslationLoader | undefined;
      if (!loader) return;
      const loaded = await loader();
      const translations =
        loaded && typeof loaded === "object" && "default" in loaded ? loaded.default : loaded;
      if (!translations || typeof translations !== "object") return;
      boundI18n?.global.mergeLocaleMessage(locale, {
        modules: { [moduleId]: translations },
      });
    })
  )
    .then(() => {
      translationsLoaded.add(moduleId);
    })
    .catch((error) => {
      translationPromises.delete(moduleId);
      Telemetry.captureException(error, {
        source: "module_translation_load",
        module_id: moduleId,
      });
    });

  translationPromises.set(moduleId, promise);
  return promise;
}
