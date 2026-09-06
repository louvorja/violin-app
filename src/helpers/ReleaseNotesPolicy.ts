/**
 * Decide se as notas da versão devem aparecer nesta execução.
 *
 * A regra é sobre a *transição* de versão, não sobre a versão atual: as notas
 * pertencem a uma atualização. Por isso a versão da execução anterior é a
 * entrada principal — sem ela, uma instalação nova era indistinguível de um
 * upgrade e mostrava changelog para quem nunca atualizou nada.
 *
 * @category helper-puro
 */
export function shouldShowReleaseNotes(params: {
  /** Versão registrada na execução anterior. `null` = primeira execução. */
  previousVersion: string | null;
  /** Versão cujas notas já foram exibidas e fechadas. */
  seenVersion: string | null;
  /** Versão em execução agora. */
  currentVersion: string;
}): boolean {
  const { previousVersion, seenVersion, currentVersion } = params;
  if (!previousVersion) return false;
  if (previousVersion === currentVersion) return false;
  return seenVersion !== currentVersion;
}
