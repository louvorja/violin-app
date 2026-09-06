import { ref, computed, type Ref, type ComputedRef } from "vue";
import { useLiturgyI18n, chaveLiturgia } from "../i18n";
import $liturgy from "@/helpers/Liturgy";
import $userdata from "@/helpers/UserData";
import $alert from "@/helpers/Alert";
import { KEYS } from "@/constants/UserDataKeys";
import type { ScheduledCategory, ScheduledItem } from "@/types/Liturgy";

export function useLiturgyPersistence() {
  const { t } = useLiturgyI18n();

  // Sempre inicia no dia de hoje (não restaura último selecionado).
  const activeDay: Ref<number> = ref(new Date().getDay());
  $liturgy.setActiveDay(activeDay.value);

  const locked: Ref<boolean> = ref($userdata.get(KEYS.MODULES.LITURGY.LOCKED, false) as boolean);
  const showNotes: Ref<boolean> = ref($userdata.get(KEYS.MODULES.LITURGY.SHOW_NOTES, true) as boolean);
  const markOnAccess: Ref<boolean> = ref(
    $userdata.get(KEYS.MODULES.LITURGY.MARK_ON_ACCESS, true) as boolean
  );
  const schedulesDialog: Ref<boolean> = ref(false);
  const activeCatId: Ref<string | number | null> = ref(null);
  const editingCatId: Ref<string | number | null> = ref(null);
  const editingCatName: Ref<string> = ref("");

  // Caches reativos de scheduled (evita $forceUpdate)
  const _scheduledCategoriesCache: Ref<ScheduledCategory[]> = ref([]);
  const _scheduledItemsCache: Ref<ScheduledItem[]> = ref([]);

  function _refreshScheduled(): void {
    _scheduledCategoriesCache.value = $liturgy.scheduledCategories();
    _scheduledItemsCache.value = $liturgy.scheduledItems();
  }
  _refreshScheduled();

  const scheduledCategories: ComputedRef<ScheduledCategory[]> = computed(
    () => _scheduledCategoriesCache.value
  );

  const activeCategory: ComputedRef<ScheduledCategory | null> = computed(
    () => _scheduledCategoriesCache.value.find((c) => c.id === activeCatId.value) || null
  );

  const categoryItems: ComputedRef<ScheduledItem[]> = computed(() => {
    if (!activeCatId.value) return [];
    return _scheduledItemsCache.value
      .filter((i) => i.categoria === activeCatId.value)
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  });

  const currentNote: ComputedRef<string> = computed(() => $liturgy.getDayNote(activeDay.value) ?? "");

  /* ============== Dia ativo ============== */
  function setActiveDay(i: number | string): void {
    const idx = Math.max(0, Math.min(6, Number(i)));
    activeDay.value = idx;
    $liturgy.setActiveDay(idx);
  }

  /* ============== Bloqueio ============== */
  function toggleLock(): void {
    locked.value = !locked.value;
    $userdata.set(KEYS.MODULES.LITURGY.LOCKED, locked.value);
  }

  /* ============== Anotações ============== */
  function setNote(html: string): void {
    $liturgy.setDayNote(activeDay.value, html ?? "");
  }

  function onNoteInput(e: Event): void {
    const target = e?.target as HTMLElement | null;
    const html = target?.innerHTML ?? (target as HTMLInputElement | null)?.value ?? "";
    setNote(html);
  }

  /* ============== Itens Agendados ============== */
  function openSchedulesDialog(): void {
    schedulesDialog.value = true;
    if (!activeCatId.value && _scheduledCategoriesCache.value.length) {
      activeCatId.value = _scheduledCategoriesCache.value[0].id;
    }
  }

  function addCategory(): void {
    $alert.prompt({ title: t("schedules.new_category") }, (nome: string | null) => {
      if (!nome || !nome.trim()) return;
      const id = $liturgy.addScheduledCategory(nome.trim());
      _refreshScheduled();
      activeCatId.value = id;
    });
  }

  function startEditingCategory(c: ScheduledCategory): void {
    editingCatId.value = c.id;
    editingCatName.value = c.nome;
  }

  function setActiveCatId(id: string | number | null): void {
    activeCatId.value = id;
  }

  function toggleNotes(): void {
    showNotes.value = !showNotes.value;
    $userdata.set(KEYS.MODULES.LITURGY.SHOW_NOTES, showNotes.value);
  }

  function toggleMarkOnAccess(): void {
    markOnAccess.value = !markOnAccess.value;
    $userdata.set(KEYS.MODULES.LITURGY.MARK_ON_ACCESS, markOnAccess.value);
  }

  function saveCategoryName(id: string | number, name?: string): void {
    const trimmed = (name ?? editingCatName.value).trim();
    if (trimmed) {
      $liturgy.updateScheduledCategory(id, { nome: trimmed });
      _refreshScheduled();
    }
    editingCatId.value = null;
  }

  function removeCategory(id: string | number): void {
    $alert.yesno({ text: chaveLiturgia("schedules.remove_category_confirm") }, (btn?: string) => {
      if (btn !== "yes") return;
      $liturgy.removeScheduledCategory(id);
      _refreshScheduled();
      if (activeCatId.value === id) activeCatId.value = null;
    });
  }

  function updateCategoryColor(id: string | number, color: string): void {
    $liturgy.updateScheduledCategory(id, { cor: color });
    _refreshScheduled();
  }

  function addScheduledItem(): void {
    if (!activeCatId.value) return;
    const today = new Date().toISOString().slice(0, 10);
    $liturgy.addScheduledItemEntry(String(activeCatId.value), today, "", "");
    _refreshScheduled();
  }

  function updateScheduled(it: ScheduledItem): void {
    $liturgy.updateScheduledItemEntry(it.id, {
      data: it.data,
      nome: it.nome,
      arquivo: it.arquivo,
      arquivo_info: it.arquivo_info,
    });
    _refreshScheduled();
  }

  function removeScheduled(id: string | number): void {
    $alert.yesno({ text: chaveLiturgia("dialog.remove_confirm") }, (btn?: string) => {
      if (btn !== "yes") return;
      $liturgy.removeScheduledItemEntry(id);
      _refreshScheduled();
    });
  }

  return {
    activeDay,
    setActiveDay,
    locked,
    showNotes,
    markOnAccess,
    toggleMarkOnAccess,
    schedulesDialog,
    activeCatId,
    editingCatId,
    editingCatName,
    scheduledCategories,
    activeCategory,
    categoryItems,
    currentNote,
    setActiveCatId,
    toggleNotes,
    toggleLock,
    setNote,
    onNoteInput,
    openSchedulesDialog,
    addCategory,
    startEditingCategory,
    saveCategoryName,
    updateCategoryColor,
    removeCategory,
    addScheduledItem,
    updateScheduled,
    removeScheduled,
  };
}
