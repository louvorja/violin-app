/**
 * @category helper-puro — Quais teclas podem ir para uma janela de projeção.
 *
 * Vive em `.mjs` pelo mesmo motivo de `displayRoles.mjs`: o renderer importa
 * direto (o Vite não converte CommonJS de arquivo do projeto em dev) e o main
 * carrega o mesmo arquivo. Uma lista só, para a tecla que o renderer decide
 * encaminhar ser exatamente a que o main aceita — duas cópias divergiriam em
 * silêncio e a tecla simplesmente deixaria de chegar.
 *
 * Módulo puro, sem Electron: o contrato de fronteira é o que os testes cobrem.
 * A lista é fechada de propósito: o IPC entrega um evento numa página que não
 * é nossa (outra origem, outra partição, sem preload), então quem escolhe a
 * tecla não pode ser quem envia qualquer tecla.
 */

/**
 * Teclas encaminhadas quando a projeção de URL está no ar.
 *
 * Setas (navegação em página), PageUp/PageDown e Home/End (rolagem) — as
 * mesmas que a mídia já registra, e que um site de rolagem entende.
 *
 * Combinações com Ctrl/Alt/Meta ficam de fora no renderer: continuam sendo
 * atalho do app ("música anterior", por exemplo).
 */
const FORWARDABLE_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
];

/**
 * Teclas encaminhadas por feature.
 *
 * São duas as janelas da URL: a de projeção e a de retorno, que é o espelho
 * da mesma URL em janela independente. Sem receber a tecla, o espelho ficaria
 * parado no slide inicial enquanto a de projeção passa — e como são duas
 * instâncias, a simetria só existe se as DUAS receberem a mesma tecla.
 */
const KEYS_BY_FEATURE = Object.freeze({
  site: FORWARDABLE_KEYS,
  site_return: FORWARDABLE_KEYS,
});

/**
 * Nome DOM → nome que `webContents.sendInputEvent` entende.
 *
 * São duas famílias diferentes de nome: o DOM fala `ArrowRight`, o Electron
 * fala `Right`. `PageUp`/`PageDown`/`Home`/`End` coincidem nas duas. Devolve
 * `null` para o que não mapeia — quem chama recusa em vez de mandar uma
 * tecla que o renderer ignora em silêncio.
 */
const INPUT_KEY_CODES = Object.freeze({
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Home: "Home",
  End: "End",
});

/**
 * @param {string} teclaDoDom  ex.: "ArrowRight"
 * @returns {string|null}      ex.: "Right"
 */
function toInputKeyCode(teclaDoDom) {
  return INPUT_KEY_CODES[teclaDoDom] ?? null;
}

/**
 * Valida `{ feature, key }` contra as allow-lists.
 *
 * @param {unknown} feature
 * @param {unknown} key
 * @returns {{ ok: true, feature: string, key: string } | { ok: false, reason: string }}
 */
function resolveKeyTarget(feature, key) {
  if (typeof feature !== "string" || !feature) return { ok: false, reason: "feature" };
  if (typeof key !== "string" || !key) return { ok: false, reason: "key" };
  const permitidas = KEYS_BY_FEATURE[feature];
  if (!permitidas) return { ok: false, reason: "feature" };
  if (!permitidas.includes(key)) return { ok: false, reason: "key" };
  return { ok: true, feature, key };
}

export { FORWARDABLE_KEYS, INPUT_KEY_CODES, KEYS_BY_FEATURE, resolveKeyTarget, toInputKeyCode };
