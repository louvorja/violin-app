import type { ProgramSession } from "@/types/Presentation";

/**
 * Caminhos que viajam entre computadores. O mesmo OneDrive mora em
 * `/Users/<usuário>/Library/CloudStorage/OneDrive…` no Mac e em
 * `C:\Users\<usuário>\OneDrive…` na igreja: o arquivo compartilhado guarda
 * o que está dentro da pasta da igreja como `igreja:Sábado/Anúncios`, e cada
 * computador completa com o próprio endereço.
 */

export const CHURCH_PREFIX = "igreja:";

const isWindowsPath = (p: string) => /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\");
const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** O caminho está dentro da pasta (ou é a própria pasta)? */
export function isInside(path: string, root: string | null | undefined): boolean {
  if (!root || !path) return false;
  const insensitive = isWindowsPath(root);
  const a = insensitive ? norm(path).toLowerCase() : norm(path);
  const b = insensitive ? norm(root).toLowerCase() : norm(root);
  return a === b || a.startsWith(`${b}/`);
}

export function isPortable(path: string | undefined): boolean {
  return !!path && path.startsWith(CHURCH_PREFIX);
}

/** Absoluto dentro da pasta → `igreja:…`; o resto (fora dela, URL) fica como está. */
export function toPortable(path: string, root: string | null | undefined): string {
  if (!root || !isInside(path, root)) return path;
  return CHURCH_PREFIX + norm(path).slice(norm(root).length).replace(/^\//, "");
}

/** `igreja:…` → absoluto neste computador; sem pasta configurada, fica como está. */
export function fromPortable(path: string, root: string | null | undefined): string {
  if (!root || !isPortable(path)) return path;
  const rel = path.slice(CHURCH_PREFIX.length);
  const sep = isWindowsPath(root) ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  return rel ? `${base}${sep}${rel.split("/").join(sep)}` : base;
}

/** Aplica `fn` a todo caminho de arquivo/pasta do programa (ou modelo), sem mexer no resto. */
export function mapPaths<T extends { sessions: ProgramSession[] }>(
  doc: T,
  fn: (_path: string) => string
): T {
  const map = (p: string | undefined) => (p ? fn(p) : p);
  return {
    ...doc,
    sessions: doc.sessions.map((s) => ({
      ...s,
      items: s.items.map((i) => ({
        ...i,
        ...(i.folder ? { folder: map(i.folder) } : {}),
        ...(i.source?.dir ? { source: { ...i.source, dir: map(i.source.dir) as string } } : {}),
        ...(i.children
          ? { children: i.children.map((c) => (c.path ? { ...c, path: map(c.path) } : c)) }
          : {}),
      })),
    })),
  };
}

/** Todos os caminhos do programa, para saber o que fica fora da pasta da igreja. */
export function allPaths(doc: { sessions: ProgramSession[] }): string[] {
  const out: string[] = [];
  mapPaths(doc, (p) => (out.push(p), p));
  return out;
}
