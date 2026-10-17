/** Contract embedded in every API ZIP; hashes cover the exact UTF-8 JSON bytes. */
export type BundleKind = "full" | "catalog" | "bible";
export interface BundleManifest {
  schema_version: 1;
  kind: BundleKind;
  files: Array<{ name: string; bytes: number; sha256: string }>;
}
export const BUNDLE_MANIFEST_FILE = "_bundle_manifest.json";
export const BUNDLE_VALIDATION_REVISION = 1;
