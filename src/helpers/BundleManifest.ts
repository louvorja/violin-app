import type { BundleKind, BundleManifest } from "@/types/Bundle";

export const isBibleFile = (name: string): boolean => /^bible_\d+_\d+_\d+\.json$/.test(name);

/** Validates untrusted package metadata before the worker exposes any dataset. */
export function validateBundleManifest(
  value: unknown,
  kind: BundleKind,
  names: string[]
): BundleManifest {
  const fail = (): never => {
    throw new Error("Bundle inválido: manifesto ou conteúdo incompleto");
  };
  if (!value || typeof value !== "object") return fail();
  const manifest = value as Partial<BundleManifest>;
  if (
    manifest.schema_version !== 1 ||
    manifest.kind !== kind ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    manifest.files.length > 50_000
  )
    return fail();
  const expected = new Set<string>();
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file !== "object" ||
      typeof file.name !== "string" ||
      !/^[A-Za-z0-9_-]+\.json$/.test(file.name) ||
      file.name.endsWith("_manifest.json") ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0 ||
      file.bytes > 50_000_000 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      expected.has(file.name)
    )
      return fail();
    expected.add(file.name);
  }
  if (names.length !== expected.size || names.some((name) => !expected.has(name))) return fail();
  const chapters = names.filter(isBibleFile).length;
  if (kind === "bible" && chapters !== names.length) return fail();
  if (kind === "catalog" && chapters !== 0) return fail();
  if (kind === "full" && chapters === 0) return fail();
  if (kind !== "bible") {
    const required = [
      "config.json",
      ...["pt", "es"].flatMap((lang) =>
        ["musics", "categories", "hymnal", "bible_version", "bible_book"].map(
          (table) => `${lang}_${table}.json`
        )
      ),
    ];
    if (required.some((name) => !expected.has(name))) return fail();
  }
  return manifest as BundleManifest;
}
