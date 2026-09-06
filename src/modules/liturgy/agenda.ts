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

function somarMinutos(time: string, minutes: number): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return time;
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

/**
 * Relógio da liturgia: um bloco carimba a hora de início do trecho e cada item
 * seguinte começa quando o anterior termina.
 *
 * A contagem não para no fim do bloco. Antes ela parava, e o item solto logo
 * abaixo — um vídeo, um anúncio — aparecia com `-:-` mesmo com o horário
 * perfeitamente determinado pelo que vinha antes. Item solto no topo da lista
 * continua sem hora, e aí é o certo: não há de onde começar a contar.
 */
function atribuirHorarios(list: LiturgyItem[]): LiturgyItem[] {
  const result: LiturgyItem[] = [];
  let prevEnd = "";

  for (const item of list) {
    if (item.tipo === LiturgyItemTypeEnum.BLOCO) {
      prevEnd = item.time || prevEnd;
      result.push({ ...item, time: prevEnd });
      continue;
    }

    const dur = Number(item.duration) || 0;
    // Hora escrita à mão num item solto reinicia a contagem a partir dela.
    const inicio = item.blocoId ? prevEnd : item.time || prevEnd;
    prevEnd = inicio ? somarMinutos(inicio, dur) : "";
    result.push({ ...item, time: inicio });
  }

  return result;
}

/** A lista como o operador a vê — no módulo e no painel da shell. */
export function prepararAgenda(lista: LiturgyItem[]): LiturgyItem[] {
  return atribuirHorarios(agruparPorBloco(lista));
}
