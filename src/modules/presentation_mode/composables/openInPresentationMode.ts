import Modules from "@/helpers/Modules";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useStage } from "./useStage";

/**
 * Abre o modo apresentação com um arquivo já no palco (prévia) — o "executar
 * avulso" de outro módulo, como a Biblioteca de Mídia com um PowerPoint. Ir ao
 * ar continua sendo gesto do operador, como com qualquer arquivo da biblioteca.
 */
export function openInPresentationMode(path: string, name?: string): void {
  const base = path.split(/[\\/]/).pop() ?? path;
  const ext = base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
  useStage().show({
    type: "file",
    entry: { name: name || base, path, isDir: false, ext, size: 0, mtimeMs: 0 },
  });
  Modules.open(ModuleEnum.PRESENTATION_MODE);
}
