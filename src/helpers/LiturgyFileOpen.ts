/**
 * Abrir um `.llja` que veio de fora da tela da Liturgia (duplo clique, "Abrir
 * com", arrastar para a janela): abre o módulo e entrega o arquivo para ele
 * importar pelo fluxo de sempre.
 */
import Modules from "@/helpers/Modules";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Path from "@/helpers/Path";
import { requestLiturgyImport } from "@/modules/liturgy/openRequests";
import { ModuleEnum } from "@/enums/ModuleEnum";

export const LLJA_RE = /\.llja$/i;

export function openLiturgyPackage(file: File): void {
  requestLiturgyImport(file);
  Modules.open(ModuleEnum.LITURGY);
}

/** Desktop: o sistema entrega o caminho; o arquivo é lido pelo protocolo local. */
export async function openLiturgyPackagePath(filePath: string): Promise<void> {
  const response = await fetchWithTimeout(Path.local(filePath), {
    timeout: NET_TIMEOUT.MEDIA,
    source: "file",
  });
  if (!response.ok) throw new Error(`não foi possível ler ${filePath} (${response.status})`);
  const name = filePath.split(/[\\/]/).pop() || "liturgia.llja";
  openLiturgyPackage(new File([await response.blob()], name));
}
