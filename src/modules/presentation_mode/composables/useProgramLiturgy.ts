import { DB_TABLE } from "@/constants/DbTables";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $alert from "@/helpers/Alert";
import $idb from "@/helpers/IndexedDB";
import $liturgy from "@/helpers/Liturgy";
import Telemetry from "@/helpers/Telemetry";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useLiturgyLibrary } from "@/modules/liturgy/composables/useLiturgyLibrary";
import { importLiturgy, programToLiturgy } from "../program/liturgy";
import { newId, useProgram } from "./useProgram";

/** O `$alert` traduz na hora de pintar: recebe a chave, não o texto. */
const alertKey = (key: string) => `modules.${ModuleEnum.PRESENTATION_MODE}.${key}`;

async function loadAnnouncements(): Promise<{ id: string; title: string }[]> {
  try {
    const all = await $idb.getAll<{ id: string | number; nome: string; ordem: number }>(DB_TABLE.ANNOUNCEMENTS);
    return all.sort((a, b) => a.ordem - b.ordem).map((a) => ({ id: String(a.id), title: a.nome }));
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.load_announcements" });
    return [];
  }
}

/** A ponte entre o programa do dia e a liturgia: importar a da semana, salvar o programa como uma. */
export function useProgramLiturgy() {
  const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
  const { date, program, setSessions, setPlannedStart } = useProgram();

  /** Liturgia do dia da semana da data do programa, copiada para o programa. */
  function importFromLiturgy(): void {
    const [y, m, d] = date.value.split("-").map(Number);
    const liturgy = $liturgy.list(new Date(y, m - 1, d).getDay());
    if (!liturgy.length) {
      $alert.info({ text: alertKey("alerts.liturgy_empty") });
      return;
    }

    const apply = async (): Promise<void> => {
      const imported = importLiturgy(liturgy, {
        newId,
        defaultSessionLabel: tm("program.default_session"),
        announcements: await loadAnnouncements(),
      });
      setSessions(imported.sessions);
      if (imported.plannedStart) setPlannedStart(imported.plannedStart);
      Telemetry.track("presentation_liturgy_imported", { items: liturgy.length });
    };

    if (!program.value.sessions.length) {
      void apply();
      return;
    }
    $alert.yesno({ title: alertKey("alerts.import_title"), text: alertKey("alerts.import_replace") }, (resp?: string) => {
      if (resp === "yes") void apply();
    });
  }

  /** O programa do dia grava sozinho; "Salvar" guarda uma cópia como liturgia reutilizável. */
  function saveAsLiturgy(): void {
    if (!program.value.sessions.length) {
      $alert.info({ text: alertKey("alerts.program_empty") });
      return;
    }
    const [y, m, d] = date.value.split("-");
    $alert.prompt(
      { title: alertKey("alerts.save_title"), input_default: tm("program.save_default_name", { date: `${d}/${m}/${y}` }) },
      (name: string | null) => {
        if (!name?.trim()) return;
        void useLiturgyLibrary()
          .save({ name: name.trim(), items: programToLiturgy(program.value, newId), binding: null })
          .then(() => $alert.info({ text: alertKey("alerts.saved") }))
          .catch((e: unknown) => {
            Telemetry.captureException(e, { source: "presentation_mode.save_as_liturgy" });
            $alert.error({ text: alertKey("alerts.save_failed") });
          });
      }
    );
  }

  return { importFromLiturgy, saveAsLiturgy };
}
