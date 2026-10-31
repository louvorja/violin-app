import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from "vue";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { useAudioPlayback } from "@/composables/useAudioPlayback";
import type { SeriesDoc, SeriesOp, SeriesVersion } from "@/types/Series";
import { PLAYED_AFTER_SECONDS, PlayedTime, playedInCycle, progressOf, splitPath } from "../program/series";
import { kindFromPath } from "../program/liturgy";
import type { LibraryEntry } from "./useFileLibrary";
import type { LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";

/**
 * Séries de vídeos da biblioteca: cada pasta pode ser uma, com o histórico do
 * que já passou gravado dentro dela. Aqui fica o que foi lido de cada pasta;
 * toda mudança é uma operação que o main aplica sobre o disco — outro
 * computador pode ter gravado na mesma pasta na nuvem.
 */

/** Pasta → série (null: a pasta não é série). Ausente: ainda não lida. */
const docs = reactive(new Map<string, SeriesDoc | null>());
/** Pasta → versões em conflito que o sincronizador deixou (vazio: nenhum conflito). */
const conflicts = reactive(new Map<string, SeriesVersion[]>());
/** Pasta cujo diálogo de série está aberto (criar ou editar). */
const dialogDir = ref<string | null>(null);

function remember(dir: string, series: SeriesDoc | null): void {
  docs.set(dir, series?.active ? series : null);
}

async function load(dir: string): Promise<SeriesDoc | null> {
  const res = await Platform.seriesRead(dir).catch(() => null);
  remember(dir, res?.ok ? res.series : null);
  conflicts.set(dir, res?.ok ? res.versions : []);
  return docs.get(dir) ?? null;
}

async function apply(dir: string, op: SeriesOp): Promise<boolean> {
  const res = await Platform.seriesApply(dir, op).catch(() => null);
  if (!res?.ok) {
    Telemetry.track("presentation_series_write_failed", { op: op.type, error: res?.error ?? "exception" });
    return false;
  }
  remember(dir, res.series);
  return true;
}

/** Junta todas as versões (`"merge"`) ou fica com a escolhida; as cópias lidas saem da pasta. */
async function resolve(dir: string, choice: string): Promise<boolean> {
  const res = await Platform.seriesResolve(dir, choice).catch(() => null);
  if (!res?.ok) return false;
  Telemetry.track("presentation_series_conflict_resolved", { merged: choice === "merge", partial: res.partial ?? 0 });
  remember(dir, res.series);
  // Cópia ainda baixando fica na pasta: relê para ela voltar a aparecer.
  if (res.partial) void load(dir);
  else conflicts.set(dir, []);
  return true;
}

/** O arquivo passou no culto: entra no histórico da série da pasta dele, se houver. */
function record(path: string): Promise<boolean> {
  const { dir, file } = splitPath(path);
  return apply(dir, { type: "play", file });
}

export function useSeries() {
  return {
    of: (dir: string | null | undefined) => (dir ? (docs.get(dir) ?? null) : null),
    conflictsOf: (dir: string | null | undefined) => (dir ? (conflicts.get(dir) ?? []) : []),
    dialogDir,
    openDialog: (dir: string) => (dialogDir.value = dir),
    load,
    resolve,
    record,
    create: (dir: string, name: string, onEnd: SeriesDoc["onEnd"]) => apply(dir, { type: "create", name, onEnd }),
    configure: (dir: string, settings: { name?: string; onEnd?: SeriesDoc["onEnd"] }) =>
      apply(dir, { type: "settings", ...settings }),
    /** A pasta deixa de ser série; o histórico fica no arquivo, desativado. */
    disable: (dir: string) => apply(dir, { type: "settings", active: false }),
    markPlayed: (dir: string, file: string) => apply(dir, { type: "play", file }),
    /** Passou por engano: o vídeo volta a estar disponível. */
    unmark: (dir: string, file: string) => apply(dir, { type: "undo", file }),
    /** Só recomeça se ninguém recomeçou depois do ciclo que o operador está vendo. */
    restart: (dir: string) => {
      const doc = docs.get(dir);
      return doc ? apply(dir, { type: "restart", fromCycle: doc.cycle }) : Promise.resolve(false);
    },
  };
}

/**
 * A pasta aberta na aba Arquivos vista como série: os vídeos que contam, o
 * que já passou e qual é o próximo. Só entram arquivos que estão de fato
 * nessa pasta — enquanto ela carrega, a barra não junta a pasta nova com os
 * arquivos da anterior.
 */
export function useFolderSeries(
  folder: { location: Ref<string | null>; entries: Ref<LibraryEntry[]> },
  ui: { locale: Ref<string>; tm: (key: string) => string }
) {
  const series = useSeries();
  const dir = computed(() => folder.location.value);

  watch(dir, (d) => d && void series.load(d), { immediate: true });

  const doc = computed(() => series.of(dir.value));
  const files = computed(() =>
    folder.entries.value
      .filter((e) => !e.isDir && splitPath(e.path).dir === dir.value)
      .filter((e) => ["video", "image"].includes(kindFromPath(e.path)))
      .map((e) => e.name)
  );
  const played = computed(() => (doc.value ? playedInCycle(doc.value) : null));
  const progress = computed(() => (doc.value ? progressOf(doc.value, files.value) : null));

  /** Data em que o arquivo passou neste ciclo ("24/09"); "" se não passou. */
  function playedOn(entry: LibraryEntry): string {
    const play = entry.isDir ? null : played.value?.get(entry.name);
    return play ? new Date(play.at).toLocaleDateString(ui.locale.value, { day: "2-digit", month: "2-digit" }) : "";
  }

  /** Marcar ou desmarcar o arquivo no menu do cartão, quando a pasta é série. */
  function menuFor(entry: LibraryEntry): LjMenuItem[] {
    const d = dir.value;
    if (!d || !doc.value || entry.isDir) return [];
    return [
      { separator: true },
      playedOn(entry)
        ? { label: ui.tm("series.unmark"), icon: ICONS.ACTIONS.UNDO, action: () => void series.unmark(d, entry.name) }
        : { label: ui.tm("series.mark"), icon: ICONS.UI.CHECK, action: () => void series.markPlayed(d, entry.name) },
    ];
  }

  return { series, dir, doc, files, progress, playedOn, menuFor };
}

/**
 * Registra na série o arquivo que ficou no ar. Vídeo conta pelo tempo que de
 * fato tocou (pausado e pulos na barra não contam); imagem, pelo tempo na tela.
 * Quem não está numa pasta de série é ignorado no main.
 */
export function useSeriesRecorder(livePath: () => string | null): void {
  const audio = useAudioPlayback();
  const played = new PlayedTime();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stopImage = watch(livePath, (path) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (path && kindFromPath(path) === "image") {
      timer = setTimeout(() => livePath() === path && void record(path), PLAYED_AFTER_SECONDS * 1000);
    }
  });
  const stopVideo = watch(
    () => [livePath(), audio.currentTime.value, audio.duration.value] as const,
    ([path, time, duration]) => {
      const video = path && kindFromPath(path) !== "image" ? path : null;
      if (played.feed(video, time, duration) && video) void record(video);
    }
  );
  onBeforeUnmount(() => {
    stopImage();
    stopVideo();
    if (timer) clearTimeout(timer);
  });
}
