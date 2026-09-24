/**
 * Vídeos do YouTube baixados de antemão: o operador deixa o vídeo pronto no
 * computador (sem depender da internet na hora do culto), vê o que já está
 * baixado e apaga o que não quer mais.
 *
 * O estado é único por janela — o módulo, a lista de processos e qualquer outro
 * componente enxergam o mesmo download em andamento e o mesmo arquivo em disco.
 * Pedidos do operador usam a raia foreground, inclusive ao preparar o próximo
 * item durante uma apresentação. Cache oportunista opta pela raia background.
 */
import { reactive } from "vue";
import * as OnlineVideo from "@/helpers/OnlineVideo";
import $snackbar from "@/helpers/Snackbar";
import { i18nAtual } from "@/i18n";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";

export interface PendingDownload {
  percent: number;
  detail: string;
  phase: OnlineVideo.OnlineVideoPhase;
}

export type DownloadState = "none" | "downloading" | "downloaded";

const files = reactive<Record<string, OnlineVideo.OnlineVideoFile>>({});
const pending = reactive<Record<string, PendingDownload>>({});
/** Qual `download()` é o dono do "baixando" de cada vídeo: o que já foi cancelado não mexe no do novo. */
const runs = new Map<string, symbol>();
const backgroundRuns = new Set<string>();

function say(key: string, params?: Record<string, unknown>): string {
  const t = i18nAtual()?.global?.t as ((k: string, p?: unknown) => unknown) | undefined;
  return t ? String(t(key, params)) : key;
}

/** Relê o que está no disco. */
async function refresh(): Promise<void> {
  const list = await OnlineVideo.listFiles();
  const present = new Set(list.map((f) => f.id));
  for (const id of Object.keys(files)) if (!present.has(id)) delete files[id];
  for (const f of list) files[f.id] = f;
}

/**
 * O vídeo está baixando (mostra o andamento no cartão). Também é chamado pelo
 * `useMedia` quando o operador manda PROJETAR um vídeo que ainda não estava no
 * disco: o download é o mesmo, e o cartão não pode fingir que nada acontece.
 */
function mark(id: string, p?: OnlineVideo.OnlineVideoProgress): void {
  pending[id] = p
    ? { percent: p.percent, detail: OnlineVideo.phaseText(p), phase: p.phase }
    : { percent: 0, detail: say("online_video.phase.queued"), phase: "queued" };
}

function unmark(id: string): void {
  delete pending[id];
}

function stateOf(id: string): DownloadState {
  if (pending[id]) return "downloading";
  return files[id] ? "downloaded" : "none";
}

export interface DownloadOptions {
  /** Guarda o vídeo: só sai quando o operador o remover. É o que o botão de baixar quer. */
  keep?: boolean;
  /** Sem aviso se falhar: usado no download que a projeção pede em segundo plano. */
  quiet?: boolean;
  /** Cache oportunista; pedidos do operador permanecem foreground por padrão. */
  background?: boolean;
}

/**
 * Baixa o vídeo (por padrão, para mantê-lo). Aparece na lista de processos em
 * segundo plano, com barra e botão de cancelar. Devolve true quando o vídeo ficou
 * em disco.
 */
async function download(id: string, name: string, options: DownloadOptions = {}): Promise<boolean> {
  const { keep = true, quiet = false, background = false } = options;
  if (!OnlineVideo.downloadAvailable()) return false;
  if (pending[id]) {
    if (background || !backgroundRuns.has(id)) return false;
    // Um clique explícito pode promover o cache já enfileirado. O main
    // reutiliza o mesmo job; seu dono original continua atualizando a UI.
    backgroundRuns.delete(id);
    const promoted = await OnlineVideo.ensure(id, undefined, { background: false, keep });
    if (!promoted.ok && promoted.error.kind !== "cancelled" && !quiet) {
      $snackbar.warning(say(OnlineVideo.messageKeyForDownloadFailure(promoted.error.kind)), {
        key: `ov-download-${id}`,
        timeout: 8000,
      });
    }
    return promoted.ok;
  }
  if (files[id]) {
    // O arquivo pode ter sido removido fora deste composable (por exemplo, pelo
    // sistema). Nesse caso a listagem local ainda é antiga e o download precisa
    // começar normalmente.
    if (await OnlineVideo.isDownloaded(id)) {
      if (!keep) return true;
      if (await OnlineVideo.keepFile(id)) {
        files[id] = { ...files[id], kept: true };
        return true;
      }
    }
    delete files[id];
    // A checagem do disco acima é assíncrona: outro pedido pode ter iniciado o
    // download enquanto ela aguardava. Reutilize a mesma regra de deduplicação.
    if (pending[id]) return download(id, name, options);
  }

  const tasks = useBackgroundTasks();
  const taskId = `online-video:${id}`;
  const token = Symbol(id);
  runs.set(id, token);
  if (background) backgroundRuns.add(id);
  const mine = (): boolean => runs.get(id) === token;
  mark(id);
  tasks.registerTask(taskId, name || id, () => OnlineVideo.cancel(id));

  const res = await OnlineVideo.ensure(
    id,
    (p) => {
      if (!mine()) return; // este download já foi cancelado; o progresso é de outro
      mark(id, p);
      tasks.updateTask(taskId, { progress: p.percent, detail: OnlineVideo.phaseText(p) });
    },
    { background, keep }
  );
  // Dono do "baixando" até aqui? Se o operador cancelou e baixou de novo, o que
  // vale é o download novo, e este não mexe no cartão nem na lista de processos.
  const current = mine();
  const release = (): void => {
    if (!mine()) return;
    unmark(id);
    runs.delete(id);
    backgroundRuns.delete(id);
  };
  if (res.ok) {
    if (current) tasks.completeTask(taskId);
    // Só solta o "baixando" depois de reler o disco: sem isso o cartão piscaria
    // "não baixado" entre o fim do download e a listagem.
    await refresh();
    release();
    return true;
  }
  release();
  if (res.error.kind === "cancelled") {
    if (current) tasks.dismissTask(taskId);
    return false;
  }
  if (!current) return false;
  tasks.updateTask(taskId, { status: "error", error: res.error.message });
  if (!quiet) {
    $snackbar.warning(say(OnlineVideo.messageKeyForDownloadFailure(res.error.kind)), {
      key: `ov-download-${id}`,
      timeout: 8000,
    });
  }
  return false;
}

/**
 * Um link acabou de entrar na lista: o download já começa e o vídeo fica guardado. Tocar a
 * qualquer momento entra no mesmo download, sem esperar o fim. Respeita quem desligou o
 * download automático.
 */
function startForNewLink(id: string, name: string): Promise<boolean> {
  if (!OnlineVideo.downloadEnabled()) return Promise.resolve(false);
  return download(id, name);
}

/**
 * O cartão volta a oferecer o download na hora, sem esperar o yt-dlp terminar de
 * sair: quem cancela e clica em baixar de novo não pode ficar preso ao antigo.
 */
function cancel(id: string): void {
  OnlineVideo.cancel(id);
  runs.delete(id);
  backgroundRuns.delete(id);
  unmark(id);
  useBackgroundTasks().dismissTask(`online-video:${id}`);
}

/** Apaga o vídeo do computador; ele segue na lista do operador. */
async function remove(id: string): Promise<void> {
  await OnlineVideo.removeFile(id);
  runs.delete(id);
  backgroundRuns.delete(id);
  unmark(id);
  delete files[id];
}

/**
 * O que o operador projetou a partir da própria lista e ficou em cache passa a ser
 * mantido: vídeo da lista dele não pode sumir quando o cache automático encher.
 */
async function adopt(ids: string[]): Promise<void> {
  await refresh();
  for (const id of ids) {
    const file = files[id];
    if (file?.kept) continue;
    // Tocando já, o arquivo ainda está baixando: o main o guarda assim que terminar.
    if (!file && !pending[id]) continue;
    if ((await OnlineVideo.keepFile(id)) && file) files[id] = { ...file, kept: true };
  }
}

export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return "0 MB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function useOnlineVideoDownloads() {
  return {
    available: OnlineVideo.downloadAvailable(),
    files,
    pending,
    stateOf,
    mark,
    unmark,
    refresh,
    download,
    startForNewLink,
    cancel,
    remove,
    adopt,
  };
}
