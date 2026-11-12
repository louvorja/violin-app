import { ref, computed, onMounted, onUnmounted, type Ref, type ComputedRef } from "vue";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useModuleMirror } from "@/composables/useModuleMirror";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { readAllSlots, getImage, resolveImageUrl } from "@/helpers/Overlay";
import $userdata from "@/helpers/UserData";
import { OVERLAY_STYLE_DEFAULTS, type OverlaySlot } from "@/types/Overlay";
import { KEYS } from "@/constants/UserDataKeys";
import { overlaySlotStyle, overlayImageStyle, overlayTextStyle } from "@/helpers/OverlayStyle";
import { OverlayVisibilityGate } from "@/presentation/OverlayVisibilityState";

interface OverlayStateReturn {
  enabled: Ref<boolean>;
  slots: Ref<OverlaySlot[]>;
  activeSlots: ComputedRef<OverlaySlot[]>;
  mirrorText: (_source: string | null | undefined) => string;
  slotImage: (_slot: OverlaySlot) => Promise<string>;
  slotStyle: (_slot: OverlaySlot) => Record<string, string>;
  imageStyle: (_slot: OverlaySlot) => Record<string, string>;
  textStyle: (_slot: OverlaySlot) => Record<string, string>;
  animationClass: (_slot: OverlaySlot) => string;
  animationExitClass: (_slot: OverlaySlot) => string;
}

export function useOverlayState(): OverlayStateReturn {
  const enabled = ref($userdata.get<boolean>(KEYS.MODULES.OVERLAY.ENABLED, false) === true);
  const slots = ref<OverlaySlot[]>([]);
  const visibilityGate = new OverlayVisibilityGate();
  let refreshGeneration = 0;
  let disposed = false;
  const imageCache = new Map<string, string>();

  function revokeImage(url: string): void {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  function pruneImages(list: OverlaySlot[]): void {
    const current = new Set(list.filter((slot) => slot.file_id).map((slot) => `${slot.id}:${slot.file_id}`));
    for (const [key, url] of imageCache) {
      if (current.has(key)) continue;
      revokeImage(url);
      imageCache.delete(key);
    }
  }

  async function refresh() {
    const generation = ++refreshGeneration;
    const list = await readAllSlots();
    if (disposed || generation !== refreshGeneration) return;
    pruneImages(list);
    slots.value = list.map((s) => ({
      ...s,
      style: { ...OVERLAY_STYLE_DEFAULTS, ...(s.style || {}) },
    }));
  }

  useBroadcastListener(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, (payload: unknown) => {
    const state = visibilityGate.accept(payload);
    if (state) enabled.value = state.enabled;
    void refresh();
  });

  useBroadcastListener(BROADCAST_TYPE.REQUEST_OVERLAY_STATE, () => {
    refresh();
  });

  onMounted(() => {
    void refresh();
    $broadcast.send(BROADCAST_TYPE.REQUEST_OVERLAY_STATE);
  });

  onUnmounted(() => {
    disposed = true;
    ++refreshGeneration;
    pruneImages([]);
  });

  const activeSlots = computed(() => {
    if (!enabled.value) return [];
    return slots.value.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  });

  const { mirrorText } = useModuleMirror(() =>
    activeSlots.value.filter((s) => s.type === "module_mirror").map((s) => s.source_module)
  );

  async function slotImage(slot: OverlaySlot): Promise<string> {
    if (!slot.file_id) return slot.content || "";
    const cacheKey = `${slot.id}:${slot.file_id}`;
    const cached = imageCache.get(cacheKey);
    if (cached) return cached;
    const record = await getImage(slot.file_id);
    if (disposed || !slots.value.some((current) => current.id === slot.id && current.file_id === slot.file_id)) {
      return "";
    }
    const existing = imageCache.get(cacheKey);
    if (existing) return existing;
    const url = resolveImageUrl(record);
    imageCache.set(cacheKey, url);
    return url;
  }

  const ANIM_CLASSES: Record<string, string> = {
    fade: "overlay-anim--fade",
    "slide-up": "overlay-anim--slide-up",
    "slide-down": "overlay-anim--slide-down",
    "slide-left": "overlay-anim--slide-left",
    "slide-right": "overlay-anim--slide-right",
    "zoom-in": "overlay-anim--zoom-in",
    "zoom-out": "overlay-anim--zoom-out",
    bounce: "overlay-anim--bounce",
    flip: "overlay-anim--flip",
    none: "",
  };

  function animationClass(slot: OverlaySlot): string {
    return (
      ANIM_CLASSES[slot.style.animation] || ANIM_CLASSES[OVERLAY_STYLE_DEFAULTS.animation] || ""
    );
  }

  function animationExitClass(slot: OverlaySlot): string {
    const anim = slot.style.animation_exit || OVERLAY_STYLE_DEFAULTS.animation_exit;
    return ANIM_CLASSES[anim] ? ANIM_CLASSES[anim] + "--exit" : "";
  }

  return {
    enabled: enabled,
    slots,
    activeSlots,
    mirrorText,
    slotImage,
    slotStyle: overlaySlotStyle,
    imageStyle: (slot) => overlayImageStyle(slot),
    textStyle: (slot) => overlayTextStyle(slot),
    animationClass,
    animationExitClass,
  };
}
