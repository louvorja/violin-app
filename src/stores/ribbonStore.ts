import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getRibbonModules } from "@/config/modules";
import type { RibbonPage } from "@/types/Ribbon";
import $appdata from "@/helpers/AppData";
import $modules from "@/helpers/Modules";
import Telemetry from "@/helpers/Telemetry";

export const useRibbonStore = defineStore("ribbon", () => {
  const pages: RibbonPage[] = getRibbonModules;

  const activePage = ref("collections");

  const activeModuleId = computed(() => $appdata.get("active_module") as string | null);

  const visiblePages = computed(() =>
    pages.filter((p) => {
      if (!p.contextual) return true;
      if (!activeModuleId.value) return false;
      return (p.activeOnModules || []).includes(activeModuleId.value);
    })
  );

  function selectPage(id: string) {
    const previousPage = activePage.value;
    if (previousPage === id) {
      Telemetry.track("ribbon_page_focused", { page_id: id });
      return;
    }
    activePage.value = id;
    Telemetry.track("ribbon_page_opened", { page_id: id, from_page: previousPage });
    const page = pages.find((p) => p.id === id);
    if (page?.defaultModule) $modules.open(page.defaultModule);
  }

  return { activePage, visiblePages, selectPage };
});
