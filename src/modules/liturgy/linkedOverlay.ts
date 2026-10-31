/**
 * Ciclo de vida da sobreposição vinculada a um item da liturgia.
 *
 * O vínculo liga o slot DEPOIS que a projeção do item confirma sucesso — e
 * precisa desligá-lo quando o item deixa o telão: ao executar outro item que
 * assume a projeção (música, arquivo, vídeo, site, anúncios) ou quando a
 * projeção é encerrada.
 *
 * Mora num módulo, e não no composable, porque existem dois caminhos de
 * execução no MESMO processo: o módulo/painel (`useLiturgyExecution`) e o
 * comando remoto (`liturgy-execute` em `main-shell.js`). A sessão é do módulo,
 * então os dois compartilham o estado.
 */

import $broadcast from "@/helpers/Broadcast";
import $userdata from "@/helpers/UserData";
import { readAllSlots, writeSlot } from "@/helpers/Overlay";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import Telemetry from "@/helpers/Telemetry";
import type { LiturgyItem } from "@/types/Liturgy";

interface SessaoOverlayVinculado {
  itemId: string;
  slotId: string;
  /** A chave geral estava ligada antes do item? Se não, o item a ligou. */
  masterJaEstavaLigado: boolean;
}

let sessao: SessaoOverlayVinculado | null = null;
let listenerDeFechamento = false;

function masterLigado(): boolean {
  return ($userdata.get(KEYS.MODULES.OVERLAY.ENABLED, false) as boolean) === true;
}

function reportarFalha(operacao: string, error: unknown): void {
  console.error(`[liturgy] sobreposição vinculada (${operacao}):`, error);
  try {
    Telemetry.captureException(error, { source: `liturgy.linked_overlay.${operacao}` });
    Telemetry.track("liturgy_linked_overlay_failed", { operation: operacao });
  } catch {
    /* telemetria nunca derruba a execução do item */
  }
}

/**
 * O fechamento da mídia (player, Esc, comando remoto) não passa por nenhum
 * fluxo da liturgia: o listener é a única forma de recolher o overlay. Começa
 * na primeira ativação e vive até o fim do processo; `replay: false` evita que
 * um `media_close` antigo do cache desligue um overlay recém-ligado.
 */
function garantirListenerDeFechamento(): void {
  if (listenerDeFechamento) return;
  listenerDeFechamento = true;
  $broadcast.listen(
    (msg) => {
      if (msg?.type === BROADCAST_TYPE.MEDIA_CLOSE) void desativarOverlayVinculado();
    },
    { replay: false }
  );
}

/**
 * O item assume o telão (e, portanto, encerra o overlay do anterior)?
 *
 * Anotação, botão de overlay e som de fundo não tiram nada do telão. Música só
 * assume quando tem slides — as versões "só áudio" não.
 */
export function itemAssumePalco(item: LiturgyItem | null | undefined, modo?: string): boolean {
  if (!item) return false;
  switch (item.tipo) {
    case LiturgyItemTypeEnum.MUSICA: {
      if (item.escolha) return false;
      const acao = modo ?? item.subtipo ?? "sung";
      return acao !== "audio" && acao !== "audio_pb";
    }
    case LiturgyItemTypeEnum.ARQUIVO:
    case LiturgyItemTypeEnum.ITENS_AGENDADOS:
    case LiturgyItemTypeEnum.MEDIA_LIBRARY:
    case LiturgyItemTypeEnum.VIDEO_ONLINE:
    case LiturgyItemTypeEnum.SITE:
    case LiturgyItemTypeEnum.ANUNCIOS:
      return true;
    default:
      return false;
  }
}

/**
 * Chamado no início da execução, antes do item assumir a projeção.
 *
 * O mesmo item (troca de versão da música, replay enquanto ainda está no ar)
 * não desliga nada: o overlay não pode piscar.
 */
export async function prepararExecucao(
  item: LiturgyItem | null | undefined,
  modo?: string
): Promise<void> {
  if (!sessao || !item) return;
  if (sessao.itemId === item.id) return;
  if (!itemAssumePalco(item, modo)) return;
  await desativarOverlayVinculado();
}

/**
 * Liga o slot vinculado depois que a projeção do item confirmou sucesso.
 *
 * Sem vínculo, não faz nada (a desativação do item anterior já aconteceu em
 * `prepararExecucao`).
 */
export async function ativarOverlayVinculado(item: LiturgyItem | null | undefined): Promise<void> {
  const slotId = item?.linked_overlay_id;
  if (!item || !slotId) return;
  garantirListenerDeFechamento();
  try {
    const slots = await readAllSlots();
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) {
      Telemetry.track("liturgy_linked_overlay_missing", { item_id: item.id });
      return;
    }
    /* Mesmo item e mesmo slot já no ar: reescrever faria o overlay piscar. */
    if (sessao?.itemId === item.id && sessao.slotId === slotId && slot.enabled) return;

    /* Troca de item: o slot anterior sai antes de o novo entrar. */
    await desativarOverlayVinculado();

    const masterJaEstavaLigado = masterLigado();
    slot.enabled = true;
    await writeSlot(slot);
    $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);
    sessao = { itemId: item.id, slotId, masterJaEstavaLigado };
    $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, { slot });
  } catch (error) {
    reportarFalha("activate", error);
  }
}

/**
 * Desliga o slot da sessão e restaura a chave geral se foi o item que a ligou.
 *
 * O slot é desligado mesmo que já estivesse ativo antes do item — o vínculo é
 * do item, não do slot. O broadcast vai sem epoch: o shell relê o `user_data`
 * e publica o estado autoritativo para as projeções.
 */
export async function desativarOverlayVinculado(): Promise<void> {
  const atual = sessao;
  if (!atual) return;
  sessao = null;
  try {
    const slots = await readAllSlots();
    const slot = slots.find((s) => s.id === atual.slotId);
    if (slot && slot.enabled) {
      slot.enabled = false;
      await writeSlot(slot);
    }
    if (!atual.masterJaEstavaLigado && masterLigado()) {
      $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, false);
    }
    $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, { slot });
  } catch (error) {
    reportarFalha("deactivate", error);
  }
}

/**
 * Esquece a sessão sem tocar no IDB e permite registrar o listener de novo.
 * Só para testes/limpeza de sessão — o fluxo normal nunca chama isto.
 */
export function resetarSessaoOverlayVinculado(): void {
  sessao = null;
  listenerDeFechamento = false;
}
