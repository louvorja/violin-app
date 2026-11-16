/**
 * Normalização e verificação de unicidade de nomes de categoria.
 *
 * Mantém a mesma régua de comparação em todos os módulos (sem diferenciar
 * caixa, acentuação NFC/NFD ou espaços extras nas pontas/meio).
 *
 * @category helper-puro
 */

export function categoryNameKey(name: string): string {
  return String(name || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export interface NamedCategoryLike {
  id: string | number;
  name?: string;
  nome?: string;
}

export function findDuplicateCategory<T extends NamedCategoryLike>(
  categories: readonly T[],
  candidateName: string,
  excludeId?: string | number | null
): T | null {
  const key = categoryNameKey(candidateName);
  if (!key) return null;
  const exclude = excludeId != null && excludeId !== "" ? String(excludeId) : null;
  return (
    categories.find((cat) => {
      if (exclude !== null && String(cat.id) === exclude) return false;
      return categoryNameKey(cat.name ?? cat.nome ?? "") === key;
    }) ?? null
  );
}
