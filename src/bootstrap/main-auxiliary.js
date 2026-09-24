import { createApp, watchEffect } from "vue";
import { createPinia } from "pinia";
import RendererApp from "@/bootstrap/RendererApp.vue";
import router from "@/router";
import { createI18nInstance } from "@/i18n";
import "@/assets/styles/tokens.css";
import "@/assets/styles/ui.css";
import "@/assets/styles/markdown.css";
import "@/assets/styles/utilities.css";
import "@/assets/styles/main.css";
import "@/assets/styles/fonts.css";
import $storage from "@/helpers/Storage";
import UserData from "@/helpers/UserData";
import $idb from "@/helpers/IndexedDB";
import { bindModuleI18n } from "@/helpers/ModuleTranslations";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { KEYS } from "@/constants/UserDataKeys";
import { FONT, resolveDefaultFont } from "@/config/Fonts";
import { startThemeSync } from "@/composables/useAppTheme";
import { BootOrchestrator } from "@/bootstrap/BootOrchestrator";
import { requiresAuxiliaryIndexedDbBeforeMount } from "@/bootstrap/auxiliaryIdbPolicy";

const bootStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

function bootStage(stage, properties = {}) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const durationMs = Math.max(0, Math.round(now - bootStartedAt));
  Telemetry.track("app_boot_stage", {
    stage,
    renderer_profile: "auxiliary",
    duration_ms: durationMs,
    ...properties,
  });
  Telemetry.histogram("louvorja.boot.stage.duration", durationMs, {
    stage,
    renderer_profile: "auxiliary",
  });
}

const app = createApp(RendererApp);
Telemetry.installVueErrorHandler(app);
app.use(createPinia());
app.use(router);

UserData.initCrossWindow();
watchEffect(() => {
  const uiFont = resolveDefaultFont(UserData.get(KEYS.OPTIONS.FONT), FONT.UI.FALLBACK);
  const projectionFont = resolveDefaultFont(
    UserData.get(KEYS.OPTIONS.PROJECTION_FONT),
    FONT.PROJECTION.FALLBACK
  );

  document.documentElement.style.setProperty(FONT.UI.CSS_VAR, uiFont);
  document.documentElement.style.setProperty(FONT.PROJECTION.CSS_VAR, projectionFont);
});
startThemeSync();

async function start() {
  await $storage.hydrate();
  bootStage("storage_hydrated");

  try {
    await UserData.load();
  } catch (error) {
    console.warn("[bootstrap/auxiliary] UserData.load falhou:", error);
  }

  const i18n = await createI18nInstance(UserData.get(KEYS.OPTIONS.LANGUAGE));
  app.use(i18n);
  bindModuleI18n(i18n);

  const requiresIdbBeforeMount = requiresAuxiliaryIndexedDbBeforeMount(window.location);
  if (requiresIdbBeforeMount) {
    // Arquivo/PDF, fundo e anúncios recuperam estado persistido já no mount.
    // Mantemos a barreira para não trocar uma reabertura correta por tela preta.
    await $idb.init();
  }
  bootStage("dependencies_ready", { indexeddb_blocking: requiresIdbBeforeMount });

  app.mount("#app");
  bootStage("mounted");

  if (!requiresIdbBeforeMount) {
    // Projeção de música/retorno/OBS ganha o primeiro mount sem esperar o
    // IndexedDB. Chamadas posteriores ao banco compartilham a mesma conexão e
    // continuam preservando o replay tardio de estado persistido.
    void $idb
      .init()
      .then(() => bootStage("indexeddb_ready"))
      .catch((error) => {
        console.warn("[bootstrap/auxiliary] IndexedDB tardio falhou:", error);
        Telemetry.captureException(error, { source: "auxiliary_indexeddb_late_init" });
      });
  }

  const orchestrator = new BootOrchestrator({
    onStage: (stage) => {
      if (stage === "after_first_paint") {
        bootStage("first_paint");
        Platform.window?.signalAppReady?.();
      }
    },
    onTaskError: (task, error) => {
      console.warn(`[bootstrap/auxiliary] tarefa "${task.id}" falhou:`, error);
      Telemetry.captureException(error, {
        source: "auxiliary_boot_task",
        task_id: task.id,
      });
    },
  });
  void orchestrator.afterFirstPaint();

  void Telemetry.init().then(() => bootStage("telemetry_ready"));
}

void start();
