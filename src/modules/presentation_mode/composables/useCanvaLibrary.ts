import { computed, ref, shallowRef } from "vue";
import Telemetry from "@/helpers/Telemetry";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import type { LibraryEntry } from "./useFileLibrary";

/**
 * O Canva no grupo Online da aba Mídia, como no FreeShow: sem credenciais, o
 * formulário de Client ID e secret; com elas, os designs da conta, por pasta.
 *
 * Usa a mesma integração das Opções → Integrações (cofre, OAuth e export no
 * main). O design vai ao ar de dois jeitos, a mesma escolha de Integrações →
 * "Projetar como": PDF exportado (um arquivo como outro qualquer, com páginas,
 * prévia e retorno) ou a página do Canva ao vivo na janela de site, que
 * mantém animação e vídeo mas exige a sessão do site do Canva.
 */

export type CanvaMode = "pdf" | "site";

export interface CanvaCrumb {
  id: string;
  name: string;
}

type ConnectResult = "connected" | "failed";

const api = () => window.louvorjaApi?.canva ?? null;

/* Estado do módulo: voltar à aba reabre a pasta onde o operador estava. */
const status = shallowRef<CanvaStatus | null>(null);
const ready = ref(false);
const busy = ref(false);
const error = ref("");
const trail = ref<CanvaCrumb[]>([]);
const items = shallowRef<CanvaItem[]>([]);
const continuation = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
/** Design sendo exportado agora — um por vez: dois jobs gastam a cota do Canva. */
const exportingId = ref<string | null>(null);
/** PDFs já exportados nesta sessão, por design e versão (`updated_at`). */
const exported = shallowRef(new Map<string, LibraryEntry>());
/* Navegar rápido pode deixar a resposta antiga chegar por último. */
let generation = 0;

/** Sem processo main não há OAuth nem export. Função, não computed: `window` não é reativo. */
const available = (): boolean => !!api();

/**
 * O modo é a preferência de Integrações, lida do store: trocar aqui ou lá vale
 * nos dois lugares.
 */
const mode = computed<CanvaMode>({
  get: () => ($userdata.get<string>(KEYS.OPTIONS.INTEGRATIONS.CANVA.PROJECT_AS, "pdf") === "site" ? "site" : "pdf"),
  set: (next) => {
    const from = mode.value;
    if (from === next) return;
    $userdata.set(KEYS.OPTIONS.INTEGRATIONS.CANVA.PROJECT_AS, next);
    Telemetry.track("canva_project_as_changed", { from, to: next });
  },
});
/** Login no site do Canva em andamento (janela própria, até o operador concluir). */
const loggingIn = ref(false);
const hasCredentials = computed(() => !!status.value?.hasCredentials);
const connected = computed(() => !!status.value?.connected);

function messageOf(e: unknown): string {
  return (e as Error)?.message || "";
}

async function refresh(): Promise<void> {
  const canva = api();
  if (!canva) {
    ready.value = true;
    return;
  }
  try {
    status.value = await canva.status();
  } catch (e) {
    error.value = messageOf(e);
  } finally {
    ready.value = true;
  }
}

/**
 * Grava as credenciais (quando vierem) e já abre a autorização no navegador:
 * um botão só, como o "Conectar a Canva" do FreeShow. O segredo não fica aqui
 * — quem chama limpa o campo assim que der certo.
 */
async function connect(credentials?: { clientId: string; clientSecret: string }): Promise<ConnectResult> {
  const canva = api();
  if (!canva || busy.value) return "failed";
  error.value = "";
  busy.value = true;
  try {
    if (credentials) {
      const saved = await canva.setCredentials(credentials.clientId.trim(), credentials.clientSecret.trim());
      if (!saved.ok) {
        error.value = saved.message || "";
        Telemetry.track("canva_credentials_failed", { reason: saved.code || "unknown" });
        return "failed";
      }
      Telemetry.track("canva_credentials_saved");
      status.value = saved;
    }
    const result = await canva.connect();
    if (!result.ok) {
      error.value = result.message || "";
      Telemetry.track("canva_connect_failed", { reason: result.code || "unknown" });
      return "failed";
    }
    Telemetry.track("canva_connected");
    await refresh();
    trail.value = [];
    void load();
    return "connected";
  } catch (e) {
    error.value = messageOf(e);
    return "failed";
  } finally {
    busy.value = false;
  }
}

/**
 * Entra no SITE do Canva, na sessão da janela de projeção: o token da API não
 * abre www.canva.com, que autentica por cookie.
 */
async function webLogin(): Promise<boolean> {
  const canva = api();
  if (!canva || loggingIn.value) return false;
  error.value = "";
  loggingIn.value = true;
  try {
    const result = await canva.webLogin();
    Telemetry.track(result.ok ? "canva_web_login_succeeded" : "canva_web_login_failed", result.ok ? {} : { reason: result.code || "unknown" });
    if (!result.ok) error.value = result.message || "";
    await refresh();
    return result.ok;
  } catch (e) {
    error.value = messageOf(e);
    return false;
  } finally {
    loggingIn.value = false;
  }
}

/** Um `view_url` novo para guardar no item do programa (a execução pede outro). */
async function siteUrl(item: CanvaItem): Promise<string> {
  try {
    const result = await api()?.designUrl(item.id);
    return result?.ok && result.url ? result.url : "";
  } catch {
    return "";
  }
}

function payload(next: string | null) {
  return { folderId: trail.value.at(-1)?.id || "root", continuation: next };
}

/** Só pastas e designs: imagem solta do Canva não tem export nem arquivo. */
function usable(list: CanvaItem[] | undefined): CanvaItem[] {
  return (list ?? []).filter((i) => i.type === "folder" || i.type === "design");
}

async function load(): Promise<void> {
  const canva = api();
  if (!canva) return;
  const mine = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await canva.items(payload(null));
    if (mine !== generation) return;
    if (!result.ok) {
      error.value = result.message || "";
      items.value = [];
      continuation.value = null;
      return;
    }
    items.value = usable(result.items);
    continuation.value = result.continuation || null;
  } catch (e) {
    if (mine === generation) error.value = messageOf(e);
  } finally {
    if (mine === generation) loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  const canva = api();
  if (!canva || !continuation.value || loadingMore.value) return;
  const mine = generation;
  loadingMore.value = true;
  try {
    const result = await canva.items(payload(continuation.value));
    if (mine !== generation) return;
    if (!result.ok) {
      error.value = result.message || "";
      return;
    }
    items.value = [...items.value, ...usable(result.items)];
    continuation.value = result.continuation || null;
  } catch (e) {
    if (mine === generation) error.value = messageOf(e);
  } finally {
    loadingMore.value = false;
  }
}

function openFolder(item: CanvaItem): void {
  trail.value = [...trail.value, { id: item.id, name: item.name }];
  void load();
}

/** `-1` é a raiz. */
function goTo(index: number): void {
  trail.value = trail.value.slice(0, index + 1);
  void load();
}

function versionKey(item: CanvaItem): string {
  return `${item.id}:${item.updatedAt ?? ""}`;
}

/** O PDF já exportado deste design, se houver — para marcar o que está no ar. */
function exportedPath(item: CanvaItem): string | null {
  return exported.value.get(versionKey(item))?.path ?? null;
}

/**
 * O PDF do design no disco, como entrada de arquivo da biblioteca. O main
 * guarda o export e só refaz quando o design mudou no Canva; aqui fica o
 * de cada versão para o clique seguinte nem passar pelo IPC.
 */
async function exportDesign(item: CanvaItem): Promise<LibraryEntry | null> {
  const canva = api();
  if (!canva || item.type !== "design") return null;
  const known = exported.value.get(versionKey(item));
  if (known) return known;
  if (exportingId.value) return null;
  exportingId.value = item.id;
  error.value = "";
  const startedAt = Date.now();
  try {
    const result = await canva.exportPdf(item.id);
    Telemetry.track("canva_export_completed", {
      ok: !!(result.ok && result.path),
      ...(result.ok ? { cached: result.cached === true } : { reason: result.code || "export_failed" }),
      duration_ms: Date.now() - startedAt,
    });
    if (!result.ok || !result.path) {
      error.value = result.message || "";
      return null;
    }
    const entry: LibraryEntry = {
      name: `${item.name}.pdf`,
      path: result.path,
      isDir: false,
      ext: "pdf",
      size: 0,
      mtimeMs: (item.updatedAt ?? 0) * 1000,
    };
    exported.value = new Map(exported.value).set(versionKey(item), entry);
    return entry;
  } catch (e) {
    error.value = messageOf(e);
    return null;
  } finally {
    exportingId.value = null;
  }
}

/** Primeira visita: o status e, conectado, a raiz. */
async function ensureLoaded(): Promise<void> {
  if (!ready.value) await refresh();
  if (connected.value && !items.value.length && !loading.value) void load();
}

export function useCanvaLibrary() {
  return {
    available,
    mode,
    loggingIn,
    status,
    ready,
    busy,
    error,
    hasCredentials,
    connected,
    trail,
    items,
    continuation,
    loading,
    loadingMore,
    exportingId,
    refresh,
    connect,
    load,
    loadMore,
    openFolder,
    goTo,
    exportDesign,
    exportedPath,
    webLogin,
    siteUrl,
    ensureLoaded,
  };
}

/** Só para os testes: o estado é do módulo e sobreviveria entre um caso e outro. */
export function resetCanvaLibrary(): void {
  status.value = null;
  ready.value = false;
  busy.value = false;
  loggingIn.value = false;
  error.value = "";
  trail.value = [];
  items.value = [];
  continuation.value = null;
  loading.value = false;
  loadingMore.value = false;
  exportingId.value = null;
  exported.value = new Map();
  generation = 0;
}
