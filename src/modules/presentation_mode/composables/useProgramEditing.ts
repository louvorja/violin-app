import { ref } from "vue";
import $alert from "@/helpers/Alert";
import type { ProgramItem, ProgramSession } from "@/types/Presentation";
import { useProgram } from "./useProgram";

/**
 * Edição do programa: os diálogos de item e de sessão, e as confirmações de
 * exclusão. O `Index` só abre e fecha; as regras ficam aqui.
 */
export function useProgramEditing(deps: {
  findItem: (itemId: string) => ProgramItem | null;
  tm: (key: string) => string;
  alertKey: (key: string) => string;
}) {
  const { findItem, tm, alertKey } = deps;
  const {
    program,
    selectedItemId,
    sessionOf,
    addSession,
    updateSession,
    removeSession,
    addItem,
    updateItem,
    duplicateItem,
    removeItem,
  } = useProgram();
  const itemDialogOpen = ref(false);
  const editingItem = ref<ProgramItem | null>(null);
  const editingSessionId = ref<string | null>(null);

  /** Garante uma sessão para receber o item: programa vazio ganha a sessão padrão. */
  function ensureSession(): string {
    const selected = selectedItemId.value ? sessionOf(selectedItemId.value) : null;
    if (selected) return selected.id;
    const last = program.value.sessions.at(-1);
    return last ? last.id : addSession(tm("program.default_session")).id;
  }

  function openNewItem(): void {
    editingItem.value = null;
    editingSessionId.value = ensureSession();
    itemDialogOpen.value = true;
  }

  function openEditItem(itemId: string): void {
    const item = findItem(itemId);
    if (!item) return;
    editingItem.value = item;
    editingSessionId.value = sessionOf(itemId)?.id ?? null;
    itemDialogOpen.value = true;
  }

  function onSaveItem({ item, sessionId }: { item: ProgramItem; sessionId: string }): void {
    if (editingItem.value) updateItem(item.id, item, sessionId);
    else addItem(item, sessionId);
  }

  function confirmRemoveItem(itemId: string | null): void {
    const item = itemId ? findItem(itemId) : null;
    if (!item) return;
    $alert.yesno(
      { title: alertKey("alerts.remove_item_title"), text: alertKey("alerts.remove_item") },
      (resp?: string) => {
        if (resp !== "yes") return;
        removeItem(item.id);
        itemDialogOpen.value = false;
      }
    );
  }

  function duplicateSelected(): void {
    if (selectedItemId.value) duplicateItem(selectedItemId.value);
  }


  const sessionDialogOpen = ref(false);
  const editingSession = ref<ProgramSession | null>(null);

  function openNewSession(): void {
    editingSession.value = null;
    sessionDialogOpen.value = true;
  }

  function openEditSession(sessionId: string): void {
    editingSession.value = program.value.sessions.find((s) => s.id === sessionId) ?? null;
    sessionDialogOpen.value = !!editingSession.value;
  }

  function onSaveSession(label: string): void {
    if (editingSession.value) updateSession(editingSession.value.id, { label });
    else addSession(label);
  }

  function confirmRemoveSession(): void {
    const session = editingSession.value;
    if (!session) return;
    const text = session.items.length ? "alerts.remove_session_items" : "alerts.remove_session";
    $alert.yesno(
      { title: alertKey("alerts.remove_session_title"), text: alertKey(text) },
      (resp?: string) => {
        if (resp !== "yes") return;
        removeSession(session.id);
        sessionDialogOpen.value = false;
      }
    );
  }

  return {
    itemDialogOpen,
    editingItem,
    editingSessionId,
    ensureSession,
    openNewItem,
    openEditItem,
    onSaveItem,
    confirmRemoveItem,
    duplicateSelected,
    sessionDialogOpen,
    editingSession,
    openNewSession,
    openEditSession,
    onSaveSession,
    confirmRemoveSession,
  };
}
