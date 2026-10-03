import { onBeforeUnmount, reactive, watch } from "vue";
import $alert from "@/helpers/Alert";
import Platform from "@/helpers/Platform";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import { i18nAtual } from "@/i18n";

/**
 * Arquivos em pastas sincronizadas com a nuvem (OneDrive, Google Drive,
 * iCloud...). Quem está só na nuvem trava o vídeo enquanto baixa — o operador
 * vê o estado na biblioteca, baixa antes, e é avisado se for passar um
 * arquivo que ainda não chegou. O programa do culto baixa sozinho o que usa.
 */

export type CloudState = "local" | "cloud" | "downloading";

/** Caminho → estado conhecido. Ausente: ainda não consultado. */
const states = reactive(new Map<string, "local" | "cloud">());
/** Caminho → andamento (0–100) dos downloads em curso. */
const progress = reactive(new Map<string, number>());
let listening = false;

function tm(key: string, params?: Record<string, unknown>): string {
  const t = i18nAtual()?.global?.t as ((k: string, p?: unknown) => unknown) | undefined;
  const full = `modules.presentation_mode.cloud.${key}`;
  return t ? String(t(full, params)) : full;
}

function listen(): void {
  if (listening) return;
  listening = true;
  Platform.onCloudProgress(({ path, percent }: { path: string; percent: number }) => {
    if (progress.has(path)) progress.set(path, percent);
  });
}

async function refresh(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const res = (await Platform.cloudStates(paths).catch(() => ({}))) as Record<string, "local" | "cloud">;
  for (const [path, state] of Object.entries(res)) states.set(path, state);
}

function stateOf(path: string): CloudState | undefined {
  return progress.has(path) ? "downloading" : states.get(path);
}

/**
 * Baixar pelo app só lê o arquivo: a nuvem pode devolvê-lo à nuvem para
 * liberar espaço. O jeito certo de fixá-lo é a opção do provedor no
 * Finder/Explorador — o aviso aparece uma vez por sessão, no texto do sistema.
 */
let keepHintShown = false;
function showKeepHint(): void {
  if (keepHintShown) return;
  keepHintShown = true;
  const os = Platform.platform === "darwin" ? "mac" : Platform.platform === "win32" ? "windows" : "other";
  $snackbar.info(tm(`keep_hint.${os}`), { timeout: 15000, key: "pm-cloud-keep-hint" });
}

async function download(path: string): Promise<boolean> {
  if (progress.has(path)) return false;
  listen();
  progress.set(path, 0);
  const res = await Platform.cloudDownload(path).catch(() => null);
  progress.delete(path);
  if (res?.ok) {
    states.set(path, "local");
    showKeepHint();
  }
  else Telemetry.track("presentation_cloud_download_failed", { error: res?.error ?? "exception" });
  return !!res?.ok;
}

/**
 * Baixa em segundo plano os que estiverem só na nuvem, um por vez, com
 * andamento na lista de tarefas do topo.
 */
async function downloadAll(paths: string[], label: string): Promise<void> {
  await refresh(paths);
  const pending = [...new Set(paths)].filter((p) => states.get(p) === "cloud" && !progress.has(p));
  if (!pending.length) return;
  const tasks = useBackgroundTasks();
  const id = `pm-cloud-${Date.now()}`;
  let cancelled = false;
  tasks.registerTask(id, label, () => (cancelled = true));
  let done = 0;
  for (const path of pending) {
    if (cancelled) break;
    tasks.updateTask(id, {
      progress: Math.round((done / pending.length) * 100),
      detail: tm("progress", { done, total: pending.length }),
    });
    await download(path);
    done++;
  }
  if (cancelled) tasks.cancelTask(id);
  else tasks.completeTask(id);
}

/**
 * Antes de passar: se o arquivo ainda está só na nuvem, pergunta. Devolve
 * se pode seguir (baixado agora, ou o operador escolheu passar assim mesmo).
 */
async function ensureLocal(path: string, name: string): Promise<boolean> {
  await refresh([path]);
  if (states.get(path) !== "cloud") return true;
  const choice = await new Promise<string>((resolve) =>
    $alert.show(
      {
        title: tm("not_here_title"),
        text: tm("not_here_text", { name }),
        translate: false,
        buttons: [
          { text: tm("play_anyway"), color: "error", value: "anyway" },
          { text: tm("download_first"), color: "info", value: "download" },
        ],
      },
      // O tipo do Alert (JS) não declara o valor do botão, que chega como 1º argumento.
      (...args: unknown[]) => resolve(String(args[0] ?? ""))
    )
  );
  if (choice === "anyway") return true;
  if (choice !== "download") return false;
  $snackbar.info(tm("downloading", { name }), { key: `pm-cloud-${path}` });
  const ok = await download(path);
  if (!ok) $snackbar.error(tm("failed", { name }));
  return ok;
}

export function useCloudFiles() {
  listen();
  return { states, progress, refresh, stateOf, download, downloadAll, ensureLocal };
}

/**
 * O programa do culto se prepara sozinho: tudo o que ele usa e ainda está só
 * na nuvem desce para o computador em segundo plano, assim que entra no
 * programa (uma vez por arquivo na sessão).
 */
export function useProgramDownloads(paths: () => string[]): void {
  const cloud = useCloudFiles();
  const asked = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = watch(
    () => paths().filter((p) => !asked.has(p)),
    (fresh) => {
      if (!fresh.length) return;
      if (timer) clearTimeout(timer);
      // Montar o programa é clicar várias vezes seguidas: espera assentar.
      timer = setTimeout(() => {
        fresh.forEach((p) => asked.add(p));
        void cloud.downloadAll(fresh, tm("program_task"));
      }, 1500);
    },
    { immediate: true }
  );
  onBeforeUnmount(() => {
    stop();
    if (timer) clearTimeout(timer);
  });
}
