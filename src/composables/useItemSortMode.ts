import { computed } from "vue";
import $userdata from "@/helpers/UserData";
import { isItemSortMode, type ItemSortMode } from "@/helpers/ItemSort";

/** Modo de ordenação persistido por módulo em `modules.<id>.sort_mode`. */
export function useItemSortMode(key: string, fallback: ItemSortMode = "custom") {
  return computed<ItemSortMode>({
    get: () => {
      const saved = $userdata.get<string>(key, fallback);
      return isItemSortMode(saved) ? saved : fallback;
    },
    set: (value) => $userdata.set(key, value),
  });
}
