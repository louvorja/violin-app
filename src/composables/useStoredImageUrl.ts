import { ref, watch, toValue, type MaybeRefOrGetter } from "vue";
import { getImageBlob } from "@/helpers/AudioLibrary";

/** Cada consumidor cria sua URL; fechar uma prévia não revoga a imagem da projeção. */
export function useStoredImageUrl(source: MaybeRefOrGetter<string | null | undefined>) {
  const url = ref("");
  watch(
    () => toValue(source),
    (value, _previous, cleanup) => {
      let current = true;
      let ownedUrl = "";
      cleanup(() => {
        current = false;
        if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      });
      const token = typeof value === "string" ? value : "";
      // Preserva URLs antigas (inclusive data:) e o protocolo desktop.
      url.value = token.startsWith("lib://image/") ? "" : token;
      if (!token.startsWith("lib://image/")) return;
      void getImageBlob(token)
        .then((blob) => {
          if (!current || !blob) return;
          ownedUrl = URL.createObjectURL(blob);
          url.value = ownedUrl;
        })
        .catch((error) => {
          if (current) console.warn("[Imagem] não foi possível ler o arquivo salvo:", error);
        });
    },
    { immediate: true }
  );
  return url;
}
