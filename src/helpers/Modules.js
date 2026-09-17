/** @category deve-virar-composable — Usa AppData (Pinia); requer renderer inicializado. */
import $dev from "@/helpers/Dev";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import Telemetry from "@/helpers/Telemetry";

/**
 * Modules — runtime de módulos (open / close / query).
 *
 * Responsabilidade: controlar visibilidade e estado de módulos já instalados.
 * Opera sobre `$appdata.modules.<id>`, populado pelo ModuleManager no boot.
 *
 * NÃO instala nem registra módulos — isso é ModuleManager.js.
 *
 * Comportamento (replica PageControl Delphi):
 * - Abrir um módulo embedded fecha automaticamente os outros embedded.
 * - Módulos popup (album, lyric, media) coexistem com embedded.
 * - O Modules.vue monta apenas o módulo embedded ativo (e popups/minimizados)
 *   e mantém os demais em cache para alternância rápida.
 */

export default {
  /** Verifica se o módulo está registrado (em $appdata.modules.<id>). */
  check(id) {
    return $appdata.exists(`modules.${id}`);
  },

  /**
   * Abre um módulo e marca como ativo.
   * @param {string} id
   */
  open(id) {
    if (!this.check(id)) {
      console.error(
        `[Modules] open(${id}) — módulo não registrado. Disponíveis:`,
        Object.keys($appdata.get("modules") || {})
      );
      return;
    }
    $dev.write("open", id);
    const wasVisible = $appdata.get(`modules.${id}.show`, false) === true;
    if (!wasVisible) Telemetry.markStart("module.open", id, { module_id: id });

    $appdata.set(`modules.${id}.show`, true);
    $appdata.set("active_module", id);
    Telemetry.track(wasVisible ? "module_focused" : "module_opened", { module_id: id });

    // Track tab opening order (first opened = leftmost).
    // Ordem ESTÁVEL: focar/reabrir um módulo não o move para o fim;
    // só é adicionado quando aberto pela primeira vez.
    const order = $userdata.get(KEYS.MODULES.OPEN_ORDER, []);
    if (!order.includes(id)) {
      order.push(id);
      $userdata.set(KEYS.MODULES.OPEN_ORDER, order);
    }
  },

  /**
   * Fecha um módulo (não importa se popup ou embedded).
   * @param {string} id
   */
  close(id) {
    if (!this.check(id)) return;
    $dev.write("close", id);

    $appdata.set(`modules.${id}.show`, false);

    // Remove from open order
    const order = $userdata.get(KEYS.MODULES.OPEN_ORDER, []);
    const idx = order.indexOf(id);
    if (idx !== -1) {
      order.splice(idx, 1);
      $userdata.set(KEYS.MODULES.OPEN_ORDER, order);
    }

    if ($appdata.get("active_module") === id) {
      const all = $appdata.get("modules") || {};
      const next = Object.values(all)
        .filter((m) => m && m.id !== id && m.show === true && m.popup !== true)
        .at(-1);

      $appdata.set("active_module", next?.id || null);
    }
    Telemetry.track("module_closed", { module_id: id });
  },

  /**
   * No shell embedded, minimizar = fechar.
   * (Tray-area do layout antigo foi removida.)
   * @param {string} id
   */
  minimize(id) {
    this.close(id);
  },

  /**
   * Retorna o objeto de um módulo específico (ou TODOS quando id é null).
   * Quando recebe um array, retorna apenas os módulos correspondentes.
   * @param {string | string[] | null} [id]
   * @returns {unknown}
   */
  get(id = null) {
    if (id == null) return $appdata.get("modules");
    if (typeof id === "string") return $appdata.get(`modules.${id}`);

    if (!Array.isArray(id) || id.length === 0) return {};

    return Object.fromEntries(
      id.map((moduleId) => [moduleId, { id: moduleId, ...$appdata.get(`modules.${moduleId}`) }])
    );
  },

  /**
   * Lista visível: módulos com show=true ou minimized=true (popups minimizados).
   * Útil para o renderer só montar quem está realmente em uso.
   */
  visible() {
    const all = $appdata.get("modules") || {};
    return Object.values(all).filter((m) => m && (m.show === true || m.minimized === true));
  },

  /**
   * Ordena lista de módulos pelo título traduzido. Usado pelo CommandPalette.
   */
  sort(modules, $t) {
    return Object.entries(modules)
      .sort(([, a], [, b]) => {
        const ta = a?.title ? $t(a.title).toLowerCase() : "";
        const tb = b?.title ? $t(b.title).toLowerCase() : "";
        return ta.localeCompare(tb);
      })
      .reduce((acc, [k, v]) => {
        acc[k] = v;
        return acc;
      }, {});
  },
  getPath(moduleId) {
    return `modules.${moduleId}`;
  },
};
