import { ref } from "vue";

/** Um destaque que acende e apaga sozinho — chamar de novo reinicia a contagem. */
export function useFlash(ms: number) {
  const on = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  function trigger(): void {
    on.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (on.value = false), ms);
  }
  return { on, trigger };
}
