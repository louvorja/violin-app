import { computed, type ComputedRef } from "vue";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { moduleShell } from "@/config/modules";

/**
 * Módulos que podem ocupar a área do ribbon e das abas de módulo — os que
 * declaram `shell.expandedKey` no manifesto.
 *
 * A preferência é por módulo e fica gravada: quem opera expandido volta
 * expandido no próximo culto. O shell só a aplica enquanto a aba do módulo
 * estiver ativa — trocar de aba devolve o ribbon sem apagar a escolha.
 */
export function isModuleExpandable(moduleId: string | null | undefined): boolean {
  return !!moduleShell(moduleId).expandedKey;
}

export function isModuleExpanded(moduleId: string | null | undefined): boolean {
  const key = moduleShell(moduleId).expandedKey;
  return !!key && $userdata.get<boolean>(key, false) === true;
}

export function setModuleExpanded(moduleId: string, value: boolean): void {
  const key = moduleShell(moduleId).expandedKey;
  if (key) $userdata.set(key, value);
}

export function toggleModuleExpanded(moduleId: string): void {
  setModuleExpanded(moduleId, !isModuleExpanded(moduleId));
}

/** Estado que o shell consulta: a aba ativa pediu para esconder o ribbon? */
export function useShellExpanded(): {
  activeModule: ComputedRef<string | null>;
  isExpanded: ComputedRef<boolean>;
} {
  const activeModule = computed(() => $appdata.get<string | null>("active_module", null));
  const isExpanded = computed(() => isModuleExpanded(activeModule.value));
  return { activeModule, isExpanded };
}
