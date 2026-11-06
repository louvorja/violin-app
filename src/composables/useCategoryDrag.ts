import { onBeforeUnmount, ref, shallowRef } from "vue";
import {
  hasMediaCategoryDrag,
  readMediaCategoryDrag,
  writeMediaCategoryDrag,
  type MediaCategoryDragSource,
} from "@/helpers/MediaCategoryDrag";

export interface CategoryDragItem {
  id: string;
  name: string;
  thumb?: string;
  icon?: string;
}

export interface CategoryTouchGhost {
  name: string;
  thumb?: string;
  icon: string;
  x: number;
  y: number;
}

interface UseCategoryDragOptions<T extends CategoryDragItem> {
  source: MediaCategoryDragSource;
  findItem: (_id: string) => T | null;
  canDrop: (_item: T, _categoryId: string) => boolean;
  assign: (_item: T, _categoryId: string) => void | Promise<void>;
  /** Rótulo exibido no fantasma; nomes de arquivo podem estar vazios. */
  label?: (_item: T) => string;
  /** Ícone exibido quando não há miniatura. */
  icon?: (_item: T) => string;
  /** Miniatura do item para o fantasma do toque e o preview nativo. */
  thumb?: (_item: T) => string | undefined;
}

interface TouchSession<T extends CategoryDragItem> {
  item: T;
  identifier: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean;
  timer: number | null;
  moveHandler: (_event: TouchEvent) => void;
  endHandler: (_event: TouchEvent) => void;
  cancelHandler: (_event: TouchEvent) => void;
}

const LONG_PRESS_MS = 350;
const CANCEL_MOVE_PX = 8;
/* Depois de um drop por toque, o navegador ainda pode sintetizar um clique no
 * card. Sem esta janela, arrastar projetaria o arquivo ao soltar. */
const CLICK_SUPPRESS_MS = 600;

/**
 * Liga o mesmo arrasto de card → categoria nas duas plataformas:
 *
 * - mouse/trackpad usa HTML5 DnD nativo (dragstart/drop);
 * - toque usa long press + ghost seguindo o dedo, porque HTML5 DnD não
 *   dispara em telas touch. O alvo é descoberto com `elementFromPoint`, e a
 *   categoria expõe o id no atributo `data-category-drop-id`.
 *
 * O componente só precisa renderizar o card, os chips com o atributo e o
 * `CategoryDragGhost`.
 */
export function useCategoryDrag<T extends CategoryDragItem>(options: UseCategoryDragOptions<T>) {
  const draggingId = ref<string | null>(null);
  const dropTargetId = ref<string | null>(null);
  const touchGhost = shallowRef<CategoryTouchGhost | null>(null);

  let touchSession: TouchSession<T> | null = null;
  let nativeDragItem: T | null = null;
  let nativeDragImage: HTMLElement | null = null;
  let nativeDragOverHandler: ((_event: DragEvent) => void) | null = null;
  let nativeDragEndHandler: (() => void) | null = null;
  let suppressClickId: string | null = null;
  let suppressClicksUntil = 0;
  let suppressCategoryId: string | null = null;
  let suppressCategoryUntil = 0;

  function suppressNextClick(id: string): void {
    suppressClickId = id;
    suppressClicksUntil = Date.now() + CLICK_SUPPRESS_MS;
  }

  function shouldSuppressClick(id: string): boolean {
    if (Date.now() >= suppressClicksUntil) {
      suppressClickId = null;
      return false;
    }
    return id === suppressClickId;
  }

  /** Evita que o clique sintetizado do toque alterne o filtro do chip. */
  function suppressCategoryClick(categoryId: string): void {
    suppressCategoryId = categoryId;
    suppressCategoryUntil = Date.now() + CLICK_SUPPRESS_MS;
  }

  function shouldSuppressCategoryClick(categoryId: string): boolean {
    if (Date.now() >= suppressCategoryUntil) {
      suppressCategoryId = null;
      return false;
    }
    return categoryId === suppressCategoryId;
  }

  function clearVisualDrag(): void {
    draggingId.value = null;
    dropTargetId.value = null;
  }

  function makeGhost(item: T, x: number, y: number): void {
    touchGhost.value = {
      name: options.label?.(item) || item.name,
      thumb: options.thumb?.(item) || item.thumb,
      icon: options.icon?.(item) || item.icon || "",
      x,
      y,
    };
  }

  function removeNativeDragImage(): void {
    nativeDragImage?.remove();
    nativeDragImage = null;
  }

  function stopNativeDragTracking(): void {
    if (nativeDragOverHandler) {
      window.removeEventListener("dragover", nativeDragOverHandler, true);
      nativeDragOverHandler = null;
    }
    if (nativeDragEndHandler) {
      window.removeEventListener("dragend", nativeDragEndHandler);
      nativeDragEndHandler = null;
    }
    nativeDragItem = null;
    touchGhost.value = null;
    removeNativeDragImage();
  }

  /**
   * O preview nativo do Chromium cobre o chip. Ele é escondido e substituído
   * por um ghost Vue que segue o mouse; assim o card arrastado — não o card da
   * grade — pode encolher e ficar transparente em cima da categoria.
   */
  function createTransparentDragImage(): HTMLElement {
    // Um canvas de 1×1 é mais confiável que um clone opaco/transparente no
    // Chromium/Electron: o preview nativo some e o ghost Vue assume o cursor.
    const node = document.createElement("canvas");
    node.width = 1;
    node.height = 1;
    node.style.position = "fixed";
    node.style.top = "-1000px";
    node.style.left = "-1000px";
    node.style.opacity = "0";
    node.style.pointerEvents = "none";
    node.setAttribute("aria-hidden", "true");
    document.body.appendChild(node);
    return node;
  }

  function onNativeDragOver(event: DragEvent): void {
    if (!nativeDragItem) return;
    makeGhost(nativeDragItem, event.clientX, event.clientY);
  }

  function startNativeDragTracking(event: DragEvent, item: T): void {
    nativeDragItem = item;
    makeGhost(item, event.clientX, event.clientY);
    nativeDragImage = createTransparentDragImage();
    if (typeof event.dataTransfer?.setDragImage === "function") {
      try {
        event.dataTransfer.setDragImage(nativeDragImage, 0, 0);
      } catch {
        removeNativeDragImage();
      }
    }
    nativeDragOverHandler = (moveEvent: DragEvent) => onNativeDragOver(moveEvent);
    window.addEventListener("dragover", nativeDragOverHandler, true);

    nativeDragEndHandler = () => stopNativeDragTracking();
    window.addEventListener("dragend", nativeDragEndHandler, { once: true });
  }

  function onCardDragStart(event: DragEvent, item: T): void {
    if (!event.dataTransfer) return;
    // Em telas touch o DnD nativo pode coexistir com o long press. O toque já
    // tem o seu próprio caminho; não deixa o navegador iniciar os dois.
    if (touchSession) {
      event.preventDefault();
      return;
    }
    writeMediaCategoryDrag(event.dataTransfer, { source: options.source, id: item.id });
    draggingId.value = item.id;
    dropTargetId.value = null;
    suppressNextClick(item.id);
    startNativeDragTracking(event, item);
  }

  function onCardDragEnd(): void {
    // Se o navegador iniciou um drag nativo por engano no toque, quem manda
    // no estado visual é a sessão touch (ghost, alvo e card esmaecido).
    if (touchSession) return;
    if (draggingId.value) suppressNextClick(draggingId.value);
    stopNativeDragTracking();
    clearVisualDrag();
  }

  function onCategoryDragOver(event: DragEvent, categoryId: string): void {
    if (!hasMediaCategoryDrag(event.dataTransfer) && draggingId.value === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropTargetId.value = categoryId;
  }

  function onCategoryDragLeave(event: DragEvent, categoryId: string): void {
    if (dropTargetId.value !== categoryId) return;
    const current = event.currentTarget;
    const related = event.relatedTarget;
    if (current instanceof Node && related instanceof Node && current.contains(related)) return;
    dropTargetId.value = null;
  }

  async function onCategoryDrop(event: DragEvent, categoryId: string): Promise<void> {
    if (!hasMediaCategoryDrag(event.dataTransfer) && draggingId.value === null) return;
    event.preventDefault();
    event.stopPropagation();

    const payload = readMediaCategoryDrag(event.dataTransfer);
    clearVisualDrag();
    stopNativeDragTracking();
    if (!payload || payload.source !== options.source) return;

    const item = options.findItem(payload.id);
    if (!item || !options.canDrop(item, categoryId)) return;

    suppressNextClick(item.id);
    suppressCategoryClick(categoryId);
    try {
      await options.assign(item, categoryId);
    } catch (error) {
      console.warn("[category-drag] falha ao mover item:", error);
    }
  }

  function findTouch(event: TouchEvent, identifier: number): Touch | null {
    for (const touch of Array.from(event.touches)) {
      if (touch.identifier === identifier) return touch;
    }
    return null;
  }

  function canDropTouch(item: T, categoryId: string): boolean {
    return options.canDrop(item, categoryId);
  }

  function updateGhost(x: number, y: number): void {
    const session = touchSession;
    if (!session) return;
    makeGhost(session.item, x, y);
  }

  function updateDropTarget(x: number, y: number): void {
    const session = touchSession;
    if (!session) return;
    const element = document.elementFromPoint(x, y);
    const target =
      element instanceof Element ? element.closest<HTMLElement>("[data-category-drop-id]") : null;
    if (!target) {
      dropTargetId.value = null;
      return;
    }
    const categoryId = target.dataset.categoryDropId;
    if (categoryId === undefined) {
      dropTargetId.value = null;
      return;
    }
    dropTargetId.value = canDropTouch(session.item, categoryId) ? categoryId : null;
  }

  function removeTouchListeners(session: TouchSession<T>): void {
    window.removeEventListener("touchmove", session.moveHandler);
    window.removeEventListener("touchend", session.endHandler);
    window.removeEventListener("touchcancel", session.cancelHandler);
  }

  function cleanupTouchSession(): void {
    const session = touchSession;
    if (!session) return;
    if (session.timer !== null) window.clearTimeout(session.timer);
    removeTouchListeners(session);
    touchSession = null;
    clearVisualDrag();
    touchGhost.value = null;
  }

  function startTouchDrag(session: TouchSession<T>): void {
    if (touchSession !== session || session.active) return;
    session.active = true;
    draggingId.value = session.item.id;
    updateGhost(session.lastX, session.lastY);
    updateDropTarget(session.lastX, session.lastY);
    try {
      navigator.vibrate?.(15);
    } catch {
      /* vibração é opcional */
    }
  }

  function onCardTouchStart(event: TouchEvent, item: T): void {
    if (event.touches.length !== 1) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-no-category-drag]")) return;

    cleanupTouchSession();
    const touch = event.touches[0];
    if (!touch) return;

    const session: TouchSession<T> = {
      item,
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      active: false,
      timer: null,
      moveHandler: () => {},
      endHandler: () => {},
      cancelHandler: () => {},
    };

    session.moveHandler = (moveEvent: TouchEvent) => {
      if (touchSession !== session) return;
      const current = findTouch(moveEvent, session.identifier);
      if (!current) return;
      session.lastX = current.clientX;
      session.lastY = current.clientY;

      if (!session.active) {
        const dx = current.clientX - session.startX;
        const dy = current.clientY - session.startY;
        if (Math.hypot(dx, dy) > CANCEL_MOVE_PX) cleanupTouchSession();
        return;
      }

      moveEvent.preventDefault();
      updateGhost(session.lastX, session.lastY);
      updateDropTarget(session.lastX, session.lastY);
    };

    session.endHandler = (endEvent: TouchEvent) => {
      if (touchSession !== session) return;
      const changed = Array.from(endEvent.changedTouches || []);
      // Com dois dedos, o fim do segundo não pode encerrar o arrasto do
      // primeiro. Quando o evento não traz changedTouches, mantém o caminho
      // simples (o chamador é o único dedo da sessão).
      if (changed.length > 0 && !changed.some((item) => item.identifier === session.identifier)) {
        return;
      }
      if (session.active) {
        const ended = changed.find((item) => item.identifier === session.identifier);
        // Um movimento rápido pode terminar sem o último touchmove; usa a
        // coordenada final do touchend para não perder o chip de destino.
        if (ended) updateDropTarget(ended.clientX, ended.clientY);
      }
      const active = session.active;
      const targetId = dropTargetId.value;
      if (active && endEvent.cancelable) endEvent.preventDefault();
      if (active) suppressNextClick(session.item.id);
      if (active && targetId !== null) suppressCategoryClick(targetId);
      cleanupTouchSession();

      if (!active || targetId === null) return;
      // Reencontra o item: ele pode ter sido removido/movido enquanto o dedo
      // estava na tela, e o objeto capturado no touchstart já estaria velho.
      const currentItem = options.findItem(session.item.id);
      if (!currentItem || !canDropTouch(currentItem, targetId)) return;
      void Promise.resolve(options.assign(currentItem, targetId)).catch((error: unknown) => {
        console.warn("[category-drag] falha ao mover item:", error);
      });
    };

    session.cancelHandler = () => {
      if (touchSession !== session) return;
      cleanupTouchSession();
    };

    touchSession = session;
    session.timer = window.setTimeout(() => {
      if (touchSession !== session) return;
      startTouchDrag(session);
    }, LONG_PRESS_MS);

    window.addEventListener("touchmove", session.moveHandler, { passive: false });
    window.addEventListener("touchend", session.endHandler, { passive: false });
    window.addEventListener("touchcancel", session.cancelHandler, { passive: false });
  }

  onBeforeUnmount(() => {
    cleanupTouchSession();
    stopNativeDragTracking();
  });

  return {
    draggingId,
    dropTargetId,
    touchGhost,
    shouldSuppressClick,
    shouldSuppressCategoryClick,
    onCardDragStart,
    onCardDragEnd,
    onCategoryDragOver,
    onCategoryDragLeave,
    onCategoryDrop,
    onCardTouchStart,
  };
}
