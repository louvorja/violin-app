import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef } from "vue";
import { getSetting } from "@/helpers/SettingsStorage";
import { estiloDeFundo } from "@/helpers/BackgroundStyle";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { DEFAULT_BACKGROUND_COLOR, MAIN_BACKGROUND_ID, type Settings } from "@/types/Settings";

/**
 * Fundo configurado em Opções → Geral (cor, imagem e ajuste), pronto para
 * virar `style`. Relê quando as Opções avisam (`WALLPAPER_UPDATE`).
 *
 * É o mesmo fundo que a projeção mostra quando não há conteúdo: usar ele na
 * "tela limpa" mantém o telão com a cara que o operador escolheu.
 */
export function useMainBackground(): { style: ComputedRef<Record<string, string>> } {
  const color = ref(DEFAULT_BACKGROUND_COLOR);
  const position = ref("cover");
  const imageUrl = ref("");
  let blobUrl: string | null = null;

  function releaseBlob(): void {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }

  async function reload(): Promise<void> {
    const s = await getSetting<Settings>(MAIN_BACKGROUND_ID).catch(() => undefined);
    color.value = s?.color || DEFAULT_BACKGROUND_COLOR;
    position.value = s?.position || "cover";
    releaseBlob();
    if (s?.image) {
      blobUrl = URL.createObjectURL(new Blob([s.image], { type: s.mime || "image/png" }));
      imageUrl.value = blobUrl;
    } else {
      imageUrl.value = "";
    }
  }

  useBroadcastListener(BROADCAST_TYPE.WALLPAPER_UPDATE, () => {
    void reload();
  });
  onMounted(() => {
    void reload();
  });
  onBeforeUnmount(releaseBlob);

  const style = computed(() =>
    estiloDeFundo({ color: color.value, imageUrl: imageUrl.value, position: position.value })
  );
  return { style };
}
