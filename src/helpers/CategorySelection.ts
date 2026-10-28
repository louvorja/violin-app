/**
 * Seleção dos chips de categoria depois de salvar no gerenciador.
 *
 * Criar uma categoria foca nela (o usuário quer vê-la), mas editar não pode
 * reativar as categorias que estavam ocultas — o filtro é escolha do usuário.
 */
export function nextCategorySelection(
  selected: ReadonlySet<string>,
  savedId: string,
  isNew: boolean
): Set<string> {
  return isNew ? new Set([savedId]) : new Set(selected);
}
