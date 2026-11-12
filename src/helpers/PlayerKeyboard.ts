/** @category deve-virar-composable — Usa AppData (Pinia); requer renderer inicializado. */
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";

/**
 * Quem fica com as teclas que passam o slide (setas, PageUp/PageDown, Home/End,
 * espaço) na janela principal: o player ou a tela em que o operador está.
 *
 * Como no Delphi, onde elas só mexiam no slide com a janela da música ou a do
 * operador ativa. O player fica com o teclado enquanto a janela da mídia está na
 * tela, depois de um clique nele (rodapé, barra da Biblioteca) e quando o operador
 * põe algo no ar. Um clique em outra parte do programa, a troca de aba ou minimizar
 * a janela da mídia devolve as teclas à tela. Antes, com uma música aberta, a seta
 * passava o slide de qualquer lugar: uma seta para rolar uma lista em outro módulo
 * avançou o slide no meio do culto.
 *
 * O foco movido pelo próprio app (a Reka devolvendo o foco ao minimizar, a busca do
 * módulo puxando o cursor) não conta: ele acompanha o clique, e a ordem entre os
 * dois não é garantida.
 */

const PLAYER_AREA = "[data-lj-player]";
let withPlayer = false;
let initialized = false;

function onPointerDown(e: PointerEvent): void {
  withPlayer = e.target instanceof Element && e.target.closest(PLAYER_AREA) !== null;
}

function onModuleOpen(): void {
  withPlayer = false;
}

function init(): void {
  if (initialized || typeof window === "undefined") return;
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("lj:module-open", onModuleOpen);
  initialized = true;
}

/**
 * O operador acabou de pôr algo no ar: o teclado vai junto. O que entra no ar sem
 * ele (fim da música, playlist, temporizador, controle remoto) não tira as teclas de
 * onde ele está — daí a ativação recente do usuário na própria janela.
 */
function claim(): void {
  if (typeof document === "undefined" || !document.hasFocus()) return;
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  if (activation?.isActive) withPlayer = true;
}

/**
 * A tecla é do player? O controle remoto chega como evento sintético e vale sempre.
 * Com a janela da mídia na tela, que é modal, o resto do programa está inerte.
 */
function hasKeys(e?: KeyboardEvent): boolean {
  if (!e?.isTrusted) return true;
  return withPlayer || $appdata.get<boolean>(KEYS.MODULES.MEDIA.SHOW, false) === true;
}

/** O operador tirou o player da frente (minimizou a janela da mídia). */
function release(): void {
  withPlayer = false;
}

export default { init, claim, hasKeys, release };
