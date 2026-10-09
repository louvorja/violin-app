/**
 * CatalogAutoInstall.ts — Quando o catálogo desce sozinho, sem o operador pedir.
 *
 * O catálogo é um ZIP de ~30MB. Só o app instalado o baixa por conta própria:
 * quem abre o endereço numa aba comum, às vezes no pacote de dados, não leva
 * esse download sem ter pedido — para ele continua valendo abrir Sincronizar.
 *
 * @category helper-puro — Sem APIs Vue.
 */

export interface CatalogAutoInstallContext {
  desktop: boolean;
  /** PWA instalado (janela própria), e não uma aba do navegador. */
  installed: boolean;
  online: boolean;
}

type ConnectionHint = { saveData?: boolean; effectiveType?: string };

export function shouldAutoInstallCatalog(
  context: CatalogAutoInstallContext,
  nav: Navigator | undefined = globalThis.navigator
): boolean {
  // No desktop a Verificação Inicial já cuida do catálogo.
  if (context.desktop || !context.installed || !context.online) return false;
  const connection = (nav as (Navigator & { connection?: ConnectionHint }) | undefined)?.connection;
  return !connection?.saveData && !/^(slow-)?2g$/.test(connection?.effectiveType ?? "");
}
