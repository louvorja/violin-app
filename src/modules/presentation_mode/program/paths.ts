import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { Program } from "@/types/Presentation";

/** Endereço de rede (http, youtube...), não arquivo do disco. */
export function isUrl(path: string): boolean {
  return /^[a-z][\w+.-]*:\/\//i.test(path);
}

/** Os arquivos do disco que o programa usa: itens de arquivo e os de cada momento. */
export function programFilePaths(program: Program): string[] {
  const paths = program.sessions
    .flatMap((s) => s.items)
    .flatMap((i) => [
      i.source?.tipo === LiturgyItemTypeEnum.ARQUIVO ? i.source.dir : undefined,
      ...(i.children ?? []).map((c) => c.path),
    ]);
  return [...new Set(paths.filter((p): p is string => !!p && !isUrl(p)))];
}
