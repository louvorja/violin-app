/**
 * useViewport — largura, altura e plataforma da janela.
 *
 * Substitui o `useDisplay()` do Vuetify, do qual o app só consumia três coisas:
 * `width`, `height` e três flags de `platform` (android, ios, electron). O
 * sistema de breakpoints (`mobile`, `smAndDown`, `mdAndUp`…) não é reproduzido
 * de propósito: nenhum consumidor o usa — todos comparam a largura com um
 * número próprio.
 *
 * O estado é compartilhado por todos os consumidores: um único listener de
 * resize alimenta os mesmos refs, ligado quando o primeiro consumidor aparece e
 * desligado quando o último se desmonta.
 */
import { getCurrentInstance, onUnmounted, readonly, ref, type Ref } from "vue";
import Platform from "@/helpers/Platform";

/** Só as flags que o app realmente pergunta — ver `Shell.vue`. */
export interface ViewportPlatform {
  android: boolean;
  ios: boolean;
  /** Renderer do Electron (via `Platform.isDesktop`), não navegador/PWA. */
  electron: boolean;
}

export interface UseViewport {
  /** Largura da janela em px. 0 enquanto não houver `window` (SSR). */
  width: Readonly<Ref<number>>;
  /** Altura da janela em px. 0 enquanto não houver `window` (SSR). */
  height: Readonly<Ref<number>>;
  platform: ViewportPlatform;
}

const _width = ref(0);
const _height = ref(0);

const width: Readonly<Ref<number>> = readonly(_width);
const height: Readonly<Ref<number>> = readonly(_height);

const _ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

/**
 * A plataforma não muda em tempo de execução, então é um objeto congelado e não
 * um ref. `electron` vem do `Platform`, o adaptador que já responde isso pelo
 * `window.louvorjaApi` injetado no preload — detectar de novo pelo user agent
 * criaria uma segunda verdade.
 */
const platform: ViewportPlatform = Object.freeze({
  android: /android/i.test(_ua),
  ios: /iphone|ipad|ipod/i.test(_ua),
  electron: !!Platform.isDesktop,
});

/** Consumidores vivos agora. O listener existe enquanto for maior que zero. */
let _consumers = 0;
let _listening = false;

function _measure(): void {
  if (typeof window === "undefined") return;
  _width.value = window.innerWidth;
  _height.value = window.innerHeight;
}

function _listen(): void {
  // Remede a cada assinatura nova: entre a saída do último consumidor e agora
  // ninguém ouvia resize, e a janela pode ter mudado de tamanho nesse intervalo.
  _measure();
  if (_listening || typeof window === "undefined") return;
  window.addEventListener("resize", _measure);
  _listening = true;
}

function _unlisten(): void {
  if (!_listening || typeof window === "undefined") return;
  window.removeEventListener("resize", _measure);
  _listening = false;
}

export function useViewport(): UseViewport {
  _consumers += 1;
  _listen();

  // Fora de um componente não há `onUnmounted` para devolver a assinatura, e
  // ela fica contada para sempre — de propósito: soltá-la sem dono congelaria
  // os valores num tamanho velho, sem ninguém para perceber.
  if (getCurrentInstance()) {
    onUnmounted(() => {
      _consumers = Math.max(0, _consumers - 1);
      if (_consumers === 0) _unlisten();
    });
  }

  return { width, height, platform };
}
