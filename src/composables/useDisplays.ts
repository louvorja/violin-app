import { ref, onMounted, onBeforeUnmount, type Ref } from "vue";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import WebDisplays from "@/helpers/projection/WebDisplays";
import WebRoles from "@/helpers/projection/WebRoles";

export interface ElectronDisplay {
  id: number | string;
  /** Posição na ordem geométrica (esquerda → direita), estável entre sessões. */
  number?: number;
  /** Nome do aparelho informado pelo sistema ("BenQ MX532"). Vazio no Linux/X11. */
  name?: string;
  index?: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  primary: boolean;
  isInternal?: boolean;
}

type DisplayPrefs = Record<string, number | string | null>;

/** Papéis de monitor. Módulos apontam para um papel, não para um monitor. */
export const DISPLAY_ROLES = ["projection", "stage", "operator"] as const;
export type DisplayRole = (typeof DISPLAY_ROLES)[number];

/**
 * No web/PWA não há API nativa de monitores, mas a escolha de papel por módulo
 * ainda precisa ser lembrada — senão a configuração se perde em silêncio.
 * Guardamos em UserData, no mesmo lugar que o desktop usa.
 */
function _webFeatureRoles(): Record<string, string> {
  return ($userdata.get(KEYS.OPTIONS.DISPLAYS.FEATURE_ROLES, {}) as Record<string, string>) ?? {};
}

export interface RoleState {
  role: string;
  /** resolved | inferred | pending | ambiguous | none */
  status: string;
  reason: string | null;
  /** Id do display no desktop; identificador da tela no navegador. */
  displayId: number | string | null;
}

/**
 * useDisplays — composable que mantém lista reativa de monitores disponíveis.
 *
 * Disponível apenas no Electron (Platform.displays). No web/PWA retorna lista vazia.
 *
 * Features comuns para preferred:
 *   - "musicas"  : monitor da projeção principal
 *   - "operador" : monitor da grade de slides
 *   - "retorno"  : monitor do stage display
 *   - "online_video" : monitor de vídeos on-line
 *   - "biblia"   : monitor da bíblia
 */
export function useDisplays(): {
  displays: Ref<ElectronDisplay[]>;
  prefs: Ref<DisplayPrefs>;
  refresh: () => Promise<void>;
  setPreferred: (feature: string, displayId: number | string) => Promise<void>;
  getPreferred: (feature: string) => number | string | null;
  identify: (durationMs?: number) => Promise<void>;
  roles: Ref<RoleState[]>;
  screenAccess: Ref<string>;
  requestScreenAccess: () => Promise<void>;
  setRole: (role: string, displayId: number | string | null) => Promise<void>;
  getFeatureRole: (feature: string) => Promise<string | null>;
  setFeatureRole: (feature: string, role: string | null) => Promise<void>;
} {
  const displays = ref<ElectronDisplay[]>([]);
  const prefs    = ref<DisplayPrefs>({});
  const roles    = ref<RoleState[]>([]);

  /**
   * Estado do acesso às telas no navegador:
   * granted | prompt | denied | unsupported | native (Electron).
   */
  const screenAccess = ref<string>("native");

  async function refresh(): Promise<void> {
    if (!Platform.displays) {
      // Web/PWA: as telas vêm da Window Management API. Sem permissão
      // concedida, o navegador só conta a tela atual — e aí não há o que
      // atribuir a papéis.
      await WebDisplays.restoreAccess();
      screenAccess.value = await WebDisplays.permissionState();
      displays.value =
        WebDisplays.isSupported() && WebDisplays.listScreens().length > 1
          ? (WebRoles.listDisplays() as unknown as ElectronDisplay[])
          : [];
      prefs.value = {};
      roles.value = WebRoles.rolesSummary();
      return;
    }
    // Cada consulta falha por conta própria: um handler IPC ausente (main
    // process desatualizado depois de um reload só da janela) não pode apagar
    // a lista de monitores e fazer a tela dizer que não há monitor nenhum.
    screenAccess.value = "native";

    try {
      const list = await Platform.displays.list();
      displays.value = Array.isArray(list) ? list : [];
    } catch (err) {
      console.error("[useDisplays] list falhou:", err);
      displays.value = [];
    }

    try {
      prefs.value = (await Platform.displays.getPrefs()) || {};
    } catch (err) {
      console.error("[useDisplays] getPrefs falhou:", err);
      prefs.value = {};
    }

    try {
      const r = await Platform.displays.getRoles?.();
      roles.value = Array.isArray(r) ? r : [];
    } catch (err) {
      console.error("[useDisplays] getRoles falhou:", err);
      roles.value = [];
    }
  }

  async function setPreferred(feature: string, displayId: number | string): Promise<void> {
    if (!Platform.displays) return;
    try {
      await Platform.displays.setPreferred(feature, displayId);
      prefs.value = { ...prefs.value, [feature]: displayId };
    } catch (err) {
      console.error("[useDisplays] setPreferred falhou:", err);
    }
  }

  function getPreferred(feature: string): number | string {
    return prefs.value?.[feature] ?? 0;
  }

  /**
   * Pede ao navegador acesso à lista de telas.
   *
   * Precisa ser chamada de dentro de um clique: sem gesto do usuário o
   * navegador recusa, e era por isso que o web nunca enxergava os monitores.
   */
  async function requestScreenAccess(): Promise<void> {
    if (Platform.displays) return;
    screenAccess.value = await WebDisplays.requestAccess();
    await refresh();
  }

  /** Atribui um monitor a um papel (Projeção / Retorno / Operador). */
  async function setRole(role: string, displayId: number | string | null): Promise<void> {
    if (!Platform.displays?.setRole) {
      WebRoles.setRole(role, displayId == null ? null : String(displayId));
      await refresh();
      return;
    }
    try {
      await Platform.displays.setRole(role, displayId as number | null);
      await refresh();
    } catch (err) {
      console.error("[useDisplays] setRole falhou:", err);
    }
  }

  /** Papel efetivo de uma feature (escolha do usuário ou padrão do módulo). */
  async function getFeatureRole(feature: string): Promise<string | null> {
    if (!Platform.displays?.getFeatureRole) return _webFeatureRoles()[feature] ?? null;
    try {
      return await Platform.displays.getFeatureRole(feature);
    } catch (err) {
      console.error("[useDisplays] getFeatureRole falhou:", err);
      return null;
    }
  }

  /** Define qual papel uma feature usa. `null` = mesma janela. */
  async function setFeatureRole(feature: string, role: string | null): Promise<void> {
    if (!Platform.displays?.setFeatureRole) {
      const next = { ..._webFeatureRoles() };
      if (role) next[feature] = role;
      else delete next[feature];
      $userdata.set(KEYS.OPTIONS.DISPLAYS.FEATURE_ROLES, next);
      return;
    }
    try {
      await Platform.displays.setFeatureRole(feature, role);
    } catch (err) {
      console.error("[useDisplays] setFeatureRole falhou:", err);
    }
  }

  async function identify(durationMs = 5000): Promise<void> {
    if (!Platform.displays) return;
    try {
      await Platform.displays.identify(durationMs);
    } catch (err) {
      console.error("[useDisplays] identify falhou:", err);
    }
  }

  let removeListener: (() => void) | null = null;

  onMounted(() => {
    refresh();

    // O main avisa quando um monitor é conectado, desconectado ou muda de
    // resolução. Antes isso era aproximado pelo evento `focus` da janela, então
    // a tela de Opções ficava mostrando monitores fantasmas enquanto aberta.
    const api = Platform.displays as { onChanged?: (cb: () => void) => () => void } | null;
    if (api?.onChanged) {
      removeListener = api.onChanged(() => refresh());
      return;
    }

    // Web/PWA (e Electron antigo, sem o evento): melhor esforço.
    if (typeof window !== "undefined") {
      const handler = () => refresh();
      window.addEventListener("focus", handler);
      removeListener = () => window.removeEventListener("focus", handler);
    }
  });

  onBeforeUnmount(() => {
    if (removeListener) removeListener();
    removeListener = null;
  });

  return {
    displays,
    prefs,
    refresh,
    setPreferred,
    getPreferred,
    identify,
    roles,
    screenAccess,
    requestScreenAccess,
    setRole,
    getFeatureRole,
    setFeatureRole,
  };
}
