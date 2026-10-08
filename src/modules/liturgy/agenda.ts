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
