/**
 * Seleção dos chips de categoria depois de salvar no gerenciador.
 *
 * Criar uma categoria deixa a nova visível, mas preserva o status das demais:
 * o usuário pode ter ocultado categorias de propósito. Editar também não pode
 * reativar as que estavam ocultas — o filtro é escolha do usuário.
 */
export function nextCategorySelection(
  selected: ReadonlySet<string>,
  savedId: string,
  isNew: boolean
): Set<string> {
  return isNew ? new Set([...selected, savedId]) : new Set(selected);
}
