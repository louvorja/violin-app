/**
 * Composable de formatação de módulo — fornece um proxy reativo (`fmt`)
 * que lê/escreve em UserData e dispara um broadcast `MODULE_FORMAT_CHANGED`
 * para que janelas de projeção atualizem ao vivo.
 *
 * Uso:
 *   const { fmt, restoreFormat, customization } = useModuleFormat(moduleId, manifest);
 *
 *   <input v-model="fmt.font_color" type="color" />
 *
 * Cada módulo declara os campos no `manifest.customization` — não há
 * necessidade de duplicar nada.
 */

import { computed, ref } from "vue";
import UserData from "@/helpers/UserData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";

interface CustomizationField {
  type: string;
  label?: string;
  default?: unknown;
  options?: string[];
}

interface ModuleManifest {
  id: string;
  customization?: Record<string, CustomizationField>;
}

export function useModuleFormat(moduleId: string, manifest: ModuleManifest) {
  const customization = computed(() => manifest.customization || {});

  // Tick ref — força re-leitura do UserData quando broadcast chega.
  const _tick = ref(0);

  useBroadcastListener(BROADCAST_TYPE.MODULE_FORMAT_CHANGED, (payload) => {
    const p = payload as { module?: string } | null;
    if (p && p.module === moduleId) _tick.value += 1;
  });

  useBroadcastListener(BROADCAST_TYPE.USERDATA_PATCH, (payload) => {
    const p = payload as { path?: string } | null;
    if (
      p &&
      typeof p.path === "string" &&
      p.path.startsWith(`modules.${moduleId}.`)
    ) {
      _tick.value += 1;
    }
  });

  const fmt = new Proxy({} as Record<string, unknown>, {
    get(_, key) {
      void _tick.value;
      return UserData.get(`modules.${moduleId}.${String(key)}`, null);
    },
    set(_, key, value) {
      UserData.set(`modules.${moduleId}.${String(key)}`, value);
      Broadcast.send(BROADCAST_TYPE.MODULE_FORMAT_CHANGED, {
        module: moduleId,
        key: String(key),
        value,
      });
      return true;
    },
  });

  function restoreFormat() {
    const fields = manifest.customization || {};
    for (const [key, def] of Object.entries(fields)) {
      UserData.set(`modules.${moduleId}.${key}`, def?.default ?? null);
    }
    Broadcast.send(BROADCAST_TYPE.MODULE_FORMAT_CHANGED, {
      module: moduleId,
      key: "*",
      value: null,
    });
  }

  // Toggle do painel "Formatar" — estado de sessão, não persistido.
  const show_format = ref(false);

  return { fmt, restoreFormat, customization, show_format };
}

const FONT_OPTIONS = [
  "Arial, sans-serif",
  "Helvetica, sans-serif",
  "Verdana, sans-serif",
  "Tahoma, sans-serif",
  "Georgia, serif",
  "Times New Roman, serif",
  "Courier New, monospace",
];

export const FORMAT_FONT_OPTIONS = FONT_OPTIONS;
