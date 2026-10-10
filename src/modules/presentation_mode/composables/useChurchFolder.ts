import { computed } from "vue";
import $userdata from "@/helpers/UserData";
import Platform from "@/helpers/Platform";
import { KEYS } from "@/constants/UserDataKeys";
import { fromPortable, isInside, toPortable } from "../program/portable";
import { useFileLibrary } from "./useFileLibrary";

/**
 * A pasta da igreja deste computador: uma pasta compartilhada (OneDrive…)
 * onde ficam os programas e os modelos, para o programa montado em casa
 * aparecer pronto no computador da igreja. É preferência de cada computador —
 * o mesmo OneDrive mora em endereços diferentes no Mac e no Windows.
 */

export type ChurchKind = "program" | "model";

export interface ChurchStat {
  ok: true;
  exists: boolean;
  mtimeMs: number | null;
  conflicts: string[];
}
export interface ChurchRead<T> {
  ok: true;
  doc: T | null;
  mtimeMs: number | null;
}
export type ChurchError = { ok: false; error: string; mtimeMs?: number | null };

const root = computed(
  () => $userdata.get<string>(KEYS.MODULES.PRESENTATION_MODE.CHURCH_FOLDER, "") || null
);

function call<T>(op: string, ...args: unknown[]): Promise<T | ChurchError> {
  return (Platform.church(op, root.value, ...args) as Promise<T | ChurchError>).catch(
    (): ChurchError => ({ ok: false, error: "exception" })
  );
}

/** As operações no disco, sempre na pasta configurada agora. */
export const churchFiles = {
  stat: (kind: ChurchKind, name: string) => call<ChurchStat>("stat", kind, name),
  read: <T>(kind: ChurchKind, name: string) => call<ChurchRead<T>>("read", kind, name),
  write: (kind: ChurchKind, name: string, doc: unknown, expectMtime?: number | null) =>
    call<{ ok: true; mtimeMs: number | null }>(
      "write",
      kind,
      name,
      doc,
      expectMtime === undefined ? {} : { expectMtime }
    ),
  list: (kind: ChurchKind) => call<{ ok: true; names: string[] }>("list", kind),
  conflicts: <T>(kind: ChurchKind, name: string) =>
    call<{ ok: true; copies: { file: string; doc: T | null; mtimeMs: number | null }[] }>(
      "conflicts",
      kind,
      name
    ),
  resolve: (kind: ChurchKind, name: string, keep: string) =>
    call<{ ok: true; mtimeMs: number | null }>("resolve", kind, name, keep),
};

let _computer: Promise<string> | null = null;
/** O nome deste computador ("Notebook da sonoplastia"), para dizer quem salvou. */
export function computerName(): Promise<string> {
  _computer ??= Platform.computerName().catch(() => "");
  return _computer;
}

export function useChurchFolder() {
  return {
    supported: Platform.isDesktop,
    root,
    async choose(): Promise<boolean> {
      const chosen = (await Platform.api?.storage?.chooseDir?.()) as string | null | undefined;
      if (!chosen) return false;
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.CHURCH_FOLDER, chosen);
      // As pastas do culto (Anúncios, séries…) ficam à mão na biblioteca.
      await useFileLibrary().includeFolder(chosen);
      return true;
    },
    clear(): void {
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.CHURCH_FOLDER, "");
    },
    isInside: (path: string) => isInside(path, root.value),
    toPortable: (path: string) => toPortable(path, root.value),
    fromPortable: (path: string) => fromPortable(path, root.value),
  };
}
