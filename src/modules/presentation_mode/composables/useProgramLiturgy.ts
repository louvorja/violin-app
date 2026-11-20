import { DB_TABLE } from "@/constants/DbTables";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $alert from "@/helpers/Alert";
import $idb from "@/helpers/IndexedDB";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useLiturgyLibrary } from "@/modules/liturgy/composables/useLiturgyLibrary";
import type { LiturgyPick } from "@/types/LiturgyLibrary";
import { importLiturgy, programToLiturgy } from "../program/liturgy";
import { liturgyTargetDate } from "../program/liturgyDate";
import { hasPendingConflict, peekProgram } from "./programStore";
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

/** A ponte entre o programa do dia e a liturgia: importar a escolhida, salvar o programa como uma. */
export function useProgramLiturgy() {
  const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
  const { date, program, setDate, setSessions, setPlannedStart } = useProgram();

  /** O dia de destino já tem programa? O operador confirma antes de trocar a data. */
  function confirmDateReplace(target: string): Promise<boolean> {
    const [y, m, d] = target.split("-");
    return new Promise((resolve) => {
      $alert.yesno(
        {
          title: tm("alerts.import_date_title"),
          text: tm("alerts.import_date_replace", { date: `${d}/${m}/${y}` }),
          translate: false,
        },
        (resp?: string) => resolve(resp === "yes")
      );
    });
  }

  /**
   * Importa uma liturgia escolhida no seletor. A data do programa passa a ser
   * a do vínculo da liturgia (próximo dia da semana, data exata ou 13º sábado);
   * sem vínculo — e para a liturgia do dia — a data atual fica como está.
   */
  async function importFromLibrary(pick: LiturgyPick): Promise<void> {
    // Com edição deste computador presa num conflito, importar descartaria o
    // que ainda não foi para a pasta da igreja (o mesmo cuidado da troca de data).
    if (hasPendingConflict()) {
      $alert.info({ text: alertKey("alerts.import_conflict") });
      return;
    }

    try {
      const target = pick.id ? liturgyTargetDate(pick.binding, date.value) : null;
      const changingDate = !!target && target !== date.value;

      if (changingDate) {
        const existing = await peekProgram(target);
        if (existing?.sessions.length && !(await confirmDateReplace(target))) return;
        // Conflito do programa aberto: `setDate` já avisa e devolve false.
        if (!(await setDate(target))) return;
      }

      const imported = importLiturgy(pick.items, {
        newId,
        defaultSessionLabel: tm("program.default_session"),
        announcements: await loadAnnouncements(),
      });
      setSessions(imported.sessions);
      if (imported.plannedStart) setPlannedStart(imported.plannedStart);
      Telemetry.track("presentation_liturgy_imported", {
        items: pick.items.length,
        source: pick.id ? "library" : "day",
        changed_date: changingDate,
      });
      $snackbar.success(tm("alerts.imported", { name: pick.name, n: pick.items.length }));
    } catch (e) {
      Telemetry.captureException(e, { source: "presentation_mode.liturgy_import" });
      $alert.error({ text: alertKey("alerts.import_failed") });
    }
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

  return { importFromLibrary, saveAsLiturgy };
}
