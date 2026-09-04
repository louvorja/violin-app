/** @category deve-virar-composable — Usa AppData (Pinia); requer renderer inicializado. */
import $appdata from "@/helpers/AppData";
import { closeWebWindow, getWebWindow, openWebWindow } from "@/helpers/projection/webWindow";

/** Chave no registry compartilhado de janelas (webWindow.ts). */
const FEATURE = "popup";
const POPUP_FEATURES = "width=800,height=600";

export default {
  async open(params) {
    if (typeof params != "object") {
      params = { module: params };
    }

    const existing = getWebWindow(FEATURE);
    if (existing) {
      existing.focus();
      // Reaproveita janela existente — sinaliza módulo via postMessage.
      try {
        existing.postMessage(
          { param: "popup_module", value: params.module },
          window.location.origin
        );
      } catch (_) {
        /* janela pode estar inicializando ainda */
      }
    } else {
      const base = import.meta.env.BASE_URL ?? "/";
      // Passa o módulo via query string para que o popup leia já no mount
      // (cada janela Electron tem seu próprio Pinia store, não dá pra compartilhar via $appdata).
      openWebWindow(
        FEATURE,
        `${base}popup?module=${encodeURIComponent(params.module)}`,
        POPUP_FEATURES
      );
    }
    $appdata.set("popup_module", params.module);
    // O handle também vive no store porque `AppData.set` espelha cada escrita
    // para dentro do popup via postMessage.
    $appdata.set("popup", getWebWindow(FEATURE));
  },
  async exit() {
    $appdata.set("popup_module", "");
  },
  async close() {
    closeWebWindow(FEATURE);
    await this.exit();
    $appdata.set("popup", null);
  },
};
