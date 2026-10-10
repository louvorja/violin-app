import { ref } from "vue";
import $docs from "@/helpers/DocStore";
import Telemetry from "@/helpers/Telemetry";
import { DB_TABLE } from "@/constants/DbTables";
import type { ProgramModel } from "@/types/Presentation";
import { fromPortable, mapPaths, toPortable } from "../program/portable";
import { churchFiles, useChurchFolder } from "./useChurchFolder";

/**
 * Modelos de culto (Sábado…). Com pasta da igreja, ficam em
 * `LouvorJA/modelos/` e valem para todo computador; sem ela, no DocStore deste.
 * Um modelo que só este computador tinha sobe para a pasta na primeira leitura.
 */

const TABLE = DB_TABLE.PRESENTATION_MODELS;
const models = ref<ProgramModel[]>([]);

const rootOf = () => useChurchFolder().root.value;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function valid(doc: unknown): doc is ProgramModel {
  const m = doc as ProgramModel | null;
  return !!m && typeof m.id === "string" && typeof m.name === "string" && Array.isArray(m.sessions);
}

const byName = (a: ProgramModel, b: ProgramModel) => a.name.localeCompare(b.name);

async function load(): Promise<ProgramModel[]> {
  const local = ((await $docs.getAll<ProgramModel>(TABLE).catch(() => [])) ?? []).filter(valid);
  const root = rootOf();
  if (!root) {
    models.value = local.sort(byName);
    return models.value;
  }
  const listed = await churchFiles.list("model");
  if (!listed.ok) {
    models.value = local.sort(byName);
    return models.value;
  }
  const shared: ProgramModel[] = [];
  for (const name of listed.names) {
    const res = await churchFiles.read<ProgramModel>("model", name);
    if (res.ok && valid(res.doc)) shared.push(mapPaths(res.doc, (p) => fromPortable(p, root)));
  }
  for (const m of local.filter((l) => !shared.some((s) => s.id === l.id))) {
    await save(m, false);
    shared.push(m);
  }
  models.value = shared.sort(byName);
  return models.value;
}

async function save(model: ProgramModel, reload = true): Promise<boolean> {
  const root = rootOf();
  try {
    await $docs.put(TABLE, clone(model));
    if (root) {
      const res = await churchFiles.write(
        "model",
        model.id,
        mapPaths(clone(model), (p) => toPortable(p, root))
      );
      if (!res.ok) {
        Telemetry.track("presentation_church_save_failed", { error: res.error, kind: "model" });
        return false;
      }
    }
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_model_save" });
    return false;
  }
  if (reload) await load();
  return true;
}

export function useProgramModels() {
  return { models, load, save };
}
