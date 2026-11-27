/**
 * De onde uma camada nasce na tela.
 *
 * Um diálogo que sempre sobe os mesmos 12px, venha de onde vier, tem cara de
 * efeito aplicado por cima. O que faz a abertura parecer consequência do gesto
 * é ela partir de onde o gesto aconteceu: o diálogo cresce a partir do botão
 * que o abriu, como qualquer janela de sistema.
 *
 * Aqui só se guarda onde foi o último toque. `applyMotionOrigin` transforma
 * isso no `transform-origin` da camada — a animação continua sendo a escala de
 * sempre, em CSS; muda o ponto em torno do qual ela escala.
 *
 * Aberta pelo teclado (atalho, Enter num botão focado) a camada não tem de
 * onde vir: fica com a origem natural dela, definida no CSS (o centro, para um
 * diálogo; o topo, para a paleta de comandos).
 *
 * @category helper-puro
 */

/** Um toque mais velho que isto já não é a causa do que está abrindo agora. */
const POINTER_WINDOW_MS = 800;

let pointerX = 0;
let pointerY = 0;
let pointerAt = -Infinity;
let keyAt = -Infinity;
let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      pointerAt = performance.now();
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    "keydown",
    () => {
      keyAt = performance.now();
    },
    { capture: true, passive: true }
  );
}

listen();

/** Onde foi o toque que abriu o que está abrindo agora — ou `null` se não houve. */
export function getMotionOrigin(now = performance.now()): { x: number; y: number } | null {
  if (now - pointerAt > POINTER_WINDOW_MS) return null;
  // Uma tecla depois do toque: quem abriu foi o teclado.
  if (keyAt > pointerAt) return null;
  return { x: pointerX, y: pointerY };
}

/**
 * Ancora a escala de `el` no ponto do último toque.
 *
 * Chame assim que a camada entra no DOM, antes da primeira pintura. O
 * `transform-origin` é relativo à caixa do elemento em repouso, então a
 * animação (ou a transição de entrada) é desligada por um instante para medir
 * essa caixa — tudo no mesmo quadro, nada disso chega à tela.
 *
 * @param restTransform `transform` do elemento em repouso, quando a entrada é
 * uma classe de transição (`*-enter-from`) e não um keyframe — desligar a
 * animação não tira a classe. Para camada animada por keyframe, omita.
 */
export function applyMotionOrigin(
  el: EventTarget | null | undefined,
  restTransform?: string
): void {
  if (!(el instanceof HTMLElement)) return;
  const origin = getMotionOrigin();
  if (!origin) {
    el.style.removeProperty("transform-origin");
    return;
  }

  const { animation, transition, transform } = el.style;
  el.style.animation = "none";
  el.style.transition = "none";
  if (restTransform !== undefined) el.style.transform = restTransform;
  const rect = el.getBoundingClientRect();
  el.style.animation = animation;
  el.style.transition = transition;
  el.style.transform = transform;

  if (rect.width === 0 || rect.height === 0) return;
  el.style.transformOrigin = `${origin.x - rect.left}px ${origin.y - rect.top}px`;
}

/** Só para teste: esquece o último toque e a última tecla. */
export function resetMotionOrigin(): void {
  pointerAt = -Infinity;
  keyAt = -Infinity;
}
