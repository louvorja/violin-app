/** @category deve-virar-composable — Usa AppData + UserData (Pinia). Boot-time; chamado 1× em main.js. */
import $appdata from "./AppData";
import $userdata from "./UserData";
import $dev from "./Dev";
import { moduleShowInMainMenu } from "@/constants/UserDataKeys";
import { ICONS } from "@/config/Icons";
import Telemetry from "@/helpers/Telemetry";
import BaseModule from "@/modules/BaseModule";
import { getAllModules } from "@/config/modules";
import { moduleTitleFallback } from "@/config/modules/titles";

// Os manifests são metadados pequenos e precisam existir para montar a Ribbon.
// As traduções, porém, são o conteúdo pesado do boot e só entram quando um
// módulo é realmente aberto. Os `index.ts` dos módulos eram apenas wrappers
// idênticos que importavam pt.json + es.json para todos os 37 módulos.
const _translationLoaders = import.meta.glob("../modules/*/lang/*.json");
const _translationPromises = new Map();
const _translationsLoaded = new Set();

/**
 * ModuleManager — lifecycle de módulos (boot-time).
 *
 * Responsabilidade: descobrir, validar, instalar e registrar módulos no store.
 * Chamado UMA VEZ durante o boot (main.js → ModuleManager.init(i18n)).
 *
 * NÃO lida com abertura/fechamento de módulos em runtime — isso é Modules.js.
 *
 * Fluxo de boot:
 *   init(i18n)
 *     └─ glob de src/modules/index.js
 *          └─ installModule(module)
 *               ├─ $appdata.set("modules.<id>", {...})   ← estado runtime
 *               ├─ $appdata.set("module_group", {...})   ← agrupamento de menu
 *               ├─ i18n.mergeLocaleMessage(...)          ← traduções
 *               └─ $userdata.setIfNull(...)              ← defaults de customização
 */
export default {
  /** Referência ao i18n, injetada por bindI18n(). */
  i18n: null,

  /**
   * Liga o gerenciador ao i18n. Uma chave `modules.<id>.*` ausente pede a
   * tradução daquele módulo, e o vue-i18n redesenha quando ela chega — quem lê
   * texto de outro módulo (BibleSpotlight, alertas do player, controle remoto)
   * não precisa lembrar de pedir. Renderers auxiliares, que não rodam init(),
   * chamam só este método.
   */
  bindI18n(i18n) {
    this.i18n = i18n;
    // Com handler de chave ausente o vue-i18n para de avisar; o aviso de dev
    // volta aqui, só para o que continua ausente com o módulo já carregado.
    i18n.global.setMissingHandler((locale, key) => {
      const moduleId = /^modules\.([^.]+)\./.exec(key)?.[1];
      if (moduleId && !_translationsLoaded.has(moduleId)) {
        void this.ensureTranslations(moduleId);
        return;
      }
      if (import.meta.env.DEV && locale === i18n.global.fallbackLocale.value) {
        console.warn(`[i18n] chave ausente "${key}"`);
      }
    });
  },

  /**
   * Carrega as duas línguas de um módulo na primeira utilização. Carregar as
   * duas mantém a troca de idioma instantânea depois que a aba foi aberta,
   * sem pagar o custo das traduções de módulos que nunca foram usados.
   */
  ensureTranslations(moduleId) {
    if (!this.i18n) return Promise.resolve();
    if (_translationPromises.has(moduleId)) return _translationPromises.get(moduleId);

    const locales = ["pt", "es"];
    const promise = Promise.all(
      locales.map(async (locale) => {
        const path = `../modules/${moduleId}/lang/${locale}.json`;
        const loader = _translationLoaders[path];
        if (typeof loader !== "function") return;
        const loaded = await loader();
        const translations = loaded?.default ?? loaded;
        if (!translations || typeof translations !== "object") return;
        this.i18n.global.mergeLocaleMessage(locale, {
          modules: { [moduleId]: translations },
        });
      })
    )
      .then(() => {
        _translationsLoaded.add(moduleId);
      })
      .catch((error) => {
        _translationPromises.delete(moduleId);
        Telemetry.captureException(error, {
          source: "module_translation_load",
          module_id: moduleId,
        });
        // Tradução é melhoria de conteúdo, não pré-condição para montar a aba.
        // Em offline/chunk desatualizado a tela funcional ainda deve abrir com
        // os títulos de metadata e as chaves globais disponíveis.
        return undefined;
      });

    _translationPromises.set(moduleId, promise);
    return promise;
  },

  /**
   * Instala um único módulo: registra no store, carrega i18n e customization.
   * Idempotente por design — a chave no $appdata é sobrescrita a cada boot.
   */
  installModule(module) {
    try {
      const manifest = module.manifest;

      if (!manifest.active) {
        if ($appdata.get("is_dev")) {
          console.warn(`Module ${manifest.id} disabled`);
        }
        return;
      }

      // Registra o módulo no $appdata para que Modules.js possa operar sobre ele.
      $appdata.set(`modules.${manifest.id}`, {
        id: manifest.id,
        title: manifest.translationKey || `modules.${manifest.id}.title`,
        icon: manifest.icon || ICONS.UI.PUZZLE,
        show: false,
        language: manifest.language,
        type: "module",
        showInMainMenu: manifest.showInMainMenu || false,
        development: manifest.development || false,
        ...(manifest.moduleOptions || {}),
        manifest,
      });

      // Adiciona ao grupo de categoria para o menu lateral.
      const category = manifest.category;
      if (category) {
        const moduleGroups = $appdata.get("module_group") || {};
        if (!moduleGroups[category]) {
          // Categoria desconhecida — cria entrada dinamicamente para não travar o boot.
          moduleGroups[category] = { title: `module_group.${category}.title`, modules: [] };
        }
        if (!moduleGroups[category].modules.includes(manifest.id)) {
          moduleGroups[category].modules.push(manifest.id);
        }
        $appdata.set("module_group", moduleGroups);
      }

      // Carrega traduções declaradas no manifesto.
      if (manifest.translations) {
        Object.entries(manifest.translations).forEach(([lang, translations]) => {
          this.i18n.global.mergeLocaleMessage(lang, {
            modules: { [manifest.id]: translations },
          });
        });
      }

      // O título fica disponível desde o boot, mesmo antes de o JSON completo
      // do módulo ser carregado sob demanda. O arquivo lazy substitui esse
      // fallback assim que a aba é aberta.
      if (manifest.name || manifest.id) {
        this.i18n.global.mergeLocaleMessage("pt", {
          modules: {
            [manifest.id]: { title: moduleTitleFallback("pt", manifest.id, manifest.name) },
          },
        });
        this.i18n.global.mergeLocaleMessage("es", {
          modules: {
            [manifest.id]: { title: moduleTitleFallback("es", manifest.id, manifest.name) },
          },
        });
      }

      // Inicializa valores padrão de customização (não sobrescreve preferências salvas).
      if (manifest.customization) {
        Object.entries(manifest.customization).forEach(([key, customization]) => {
          $userdata.setIfNull(`modules.${manifest.id}.${key}`, customization.default ?? null);
        });
      }

      // Visibilidade no menu (modules.<id>.show_in_main_menu) — default do manifest.
      $userdata.setIfNull(
        moduleShowInMainMenu(manifest.id),
        manifest.defaultShowInMainMenu ?? manifest.showInMainMenu
      );

      $dev.write("module_install", manifest.id, manifest.development ? "[dev]" : "");
      return true;
    } catch (error) {
      console.error(`Failed to install module ${module.manifest.id}:`, error);
      Telemetry.captureException(error, {
        source: "module_install",
        module_id: module.manifest.id,
      });
      return false;
    }
  },

  /**
   * Ponto de entrada do boot. Descobre todos os módulos via glob,
   * valida a consistência pasta/id e instala cada um.
   *
   * Chamado em main.js após createApp(), antes do mount().
   */
  async init(i18n) {
    this.bindI18n(i18n);

    // Os manifests já são metadados suficientes para construir o registro.
    // Registrar um BaseModule diretamente evita importar 37 wrappers que
    // puxavam as traduções completas dos dois idiomas para o caminho crítico.
    const manifests = Object.values(getAllModules).sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    );
    for (const manifest of manifests) {
      try {
        this.installModule(new BaseModule(manifest));
      } catch (e) {
        console.warn(`[ModuleManager] Falha ao instalar módulo ${manifest.id}:`, e);
        Telemetry.captureException(e, { source: "module_manager_init", module_id: manifest.id });
      }
    }

    // Sinaliza ao renderer que os componentes de módulo podem ser importados.
    $appdata.set("import_modules", true);
  },
};
