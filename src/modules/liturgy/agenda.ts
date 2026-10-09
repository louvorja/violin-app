import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";

/**
 * Preparo da lista para exibição: agrupar os itens sob o bloco a que pertencem
 * e calcular a hora de cada um.
 *
 * Fica fora do `useLiturgyItems` porque a shell também mostra a liturgia, no
 * painel lateral. Enquanto isso era privado do módulo, o painel listava os
 * itens crus: um item podia aparecer numa ordem no painel e em outra na tela
 * cheia, e nenhum deles exibia horário.
 */
export function agruparPorBloco(list: LiturgyItem[]): LiturgyItem[] {
  const result: LiturgyItem[] = [];
  let pending: LiturgyItem[] = [];
  let currentBloco: LiturgyItem | null = null;

  for (const item of list) {
    if (item.tipo === LiturgyItemTypeEnum.BLOCO) {
      if (currentBloco) {
        result.push(currentBloco);
        result.push(...pending);
      } else if (pending.length > 0) {
        result.push(...pending);
      }
      currentBloco = item;
      pending = [];
    } else {
      pending.push(item);
    }
  }
  if (currentBloco) {
    result.push(currentBloco);
    result.push(...pending);
  } else if (pending.length > 0) {
    result.push(...pending);
  }

  return result;
}

/*
 * A posição no array é o que decide em que bloco o item aparece: a timeline é
 * um `v-for` plano e um cabeçalho BLOCO abre uma seção que vai até o próximo
 * cabeçalho (ou até o fim). Dentro dessa seção convivem itens do bloco — os
 * que têm `blocoId` igual ao do cabeçalho — e itens soltos, que a tela mostra
 * embaixo do cabeçalho mas sem a faixa do bloco.
 *
 * Por isso "fim do bloco" tem duas leituras e só uma serve para posicionar:
 * o fim da SEÇÃO é a borda com o próximo cabeçalho, e os soltos não fazem
 * parte do bloco. O fim do BLOCO é depois do último item vinculado a ele (ou
 * logo abaixo do cabeçalho, quando o bloco ainda não tem filhos) — é isso
 * que o `saveItem` usa para entrar num bloco e para mover o item quando o
 * operador troca o bloco, o que antes só acontecia via drag-and-drop.
 */

/** Cabeçalho BLOCO da seção que contém `indice`. */
export function blocoDaSecao(lista: LiturgyItem[], indice: number): string | null {
  if (indice <= 0 || indice >= lista.length) return null;
  if (lista[indice].tipo === LiturgyItemTypeEnum.BLOCO) return null;
  for (let i = indice - 1; i >= 0; i--) {
    if (lista[i].tipo === LiturgyItemTypeEnum.BLOCO) return lista[i].id || null;
  }
  return null;
}

/**
 * Primeiro índice depois do último item vinculado ao bloco dentro da seção.
 * Bloco sem filhos ganha o item logo abaixo do cabeçalho: os soltos que vêm
 * em seguida não são do bloco, então entrar nele não empurra o item para o
 * fim da seção. `lista.length` quando o bloco não existe (ou não há bloco).
 */
export function indiceFimDoBloco(lista: LiturgyItem[], blocoId?: string | null): number {
  if (!blocoId) return lista.length;
  const inicio = lista.findIndex(
    (i) => i.tipo === LiturgyItemTypeEnum.BLOCO && i.id === blocoId
  );
  if (inicio < 0) return lista.length;
  let destino = inicio + 1;
  let i = inicio + 1;
  while (i < lista.length && lista[i].tipo !== LiturgyItemTypeEnum.BLOCO) {
    if (lista[i].blocoId === blocoId) destino = i + 1;
    i++;
  }
  return destino;
}

/**
 * Move o item para depois do último item do bloco. O destino é calculado
 * sobre a lista já sem o item, então não há aritmética de índice: sai do
 * lugar antigo e entra logo atrás do último filho (ou do cabeçalho).
 * Devolve a mesma referência quando a posição não muda.
 */
export function reposicionarParaBloco(
  lista: LiturgyItem[],
  id: string,
  blocoId: string
): LiturgyItem[] {
  const idx = lista.findIndex((i) => i.id === id);
  if (idx < 0) return lista;
  const semOItem = lista.filter((i) => i.id !== id);
  const destino = indiceFimDoBloco(semOItem, blocoId);
  if (destino === idx) return lista;
  const nova = [...semOItem];
  nova.splice(destino, 0, lista[idx]);
  return nova;
}

function somarMinutos(time: string, minutes: number): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return time;
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

/** A hora vem também de arquivos importados; valores inválidos não viram âncoras. */
export function lerHorario(value: unknown): string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
    ? value.slice(0, 5)
    : "";
}

/**
 * Relógio da liturgia: um bloco carimba a hora de início do trecho e cada item
 * seguinte começa quando o anterior termina — incluindo itens fora do bloco.
 *
 * A hora manual é uma âncora. Horas automáticas são calculadas novamente a
 * cada alteração, sem transformar a hora exibida numa escolha do operador.
 * Dados antigos não distinguiam as duas: preservamos a primeira hora e as que
 * diferem da continuação; as coincidentes continuam automáticas. A inferência
 * só é necessária até o próximo save, que grava o modo explicitamente.
 */
function atribuirHorarios(list: LiturgyItem[]): LiturgyItem[] {
  const result: LiturgyItem[] = [];
  let prevEnd = "";

  for (const item of list) {
    const hora = lerHorario(item.time);
    const gerenciado = item.tipo !== LiturgyItemTypeEnum.BLOCO && !!item.blocoId;
    const modo =
      gerenciado || item.time_mode === "auto" || !hora
        ? "auto"
        : item.time_mode === "manual" || item.tipo === LiturgyItemTypeEnum.BLOCO || hora !== prevEnd
          ? "manual"
          : "auto";
    const inicio = modo === "manual" ? hora : prevEnd;
    if (item.tipo === LiturgyItemTypeEnum.BLOCO) {
      prevEnd = inicio;
      result.push({ ...item, time: inicio, time_mode: modo });
      continue;
    }

    const dur = Number(item.duration) || 0;
    prevEnd = inicio ? somarMinutos(inicio, dur) : "";
    result.push({ ...item, time: inicio, time_mode: modo });
  }

  return result;
}

/** A lista como o operador a vê — no módulo e no painel da shell. */
export function prepararAgenda(lista: LiturgyItem[]): LiturgyItem[] {
  return atribuirHorarios(agruparPorBloco(lista));
}

/** Persistência guarda somente as âncoras; a hora automática pertence à exibição. */
export function agendaParaPersistir(lista: LiturgyItem[]): LiturgyItem[] {
  return prepararAgenda(lista).map((item) => ({
    ...item,
    time: item.time_mode === "manual" ? item.time : "",
  }));
}
