/**
 * Limites de armazenamento por plataforma.
 *
 * Desktop grava no acervo, então o teto é de produto: 5 GB por arquivo e por
 * pacote. No navegador os bytes ficam no IndexedDB, onde um registro grande é
 * caro e arriscado — o teto é 500 MB, com aviso para usar o app desktop acima
 * disso. Nenhum dos dois é limite de memória: o pacote é lido/gravado em
 * streaming.
 *
 * Próximo passo (web): OPFS. Guardar os bytes no Origin Private File System e
 * deixar no IndexedDB só metadados + caminho, como o desktop faz com o acervo,
 * permitiria pacotes maiores e abrir a biblioteca sem carregar Blob.
 *
 * @category helper-puro — sem Vue, sem IndexedDB.
 */
import Platform from "@/helpers/Platform";
import { opfsActive } from "@/helpers/OpfsStore";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** Teto de um arquivo isolado (biblioteca, projeção, som, arquivo da liturgia). */
export const MAX_DESKTOP_FILE_BYTES = 5 * GB;
/** Fallback web quando OPFS/Service Worker não estão disponíveis. */
export const MAX_WEB_FILE_BYTES = 500 * MB;
/** Web com OPFS: mesmo teto de produto do desktop. */
export const MAX_WEB_OPFS_FILE_BYTES = 5 * GB;

/** Teto do pacote `.llja` inteiro (soma dos arquivos, não o ZIP comprimido). */
export const MAX_DESKTOP_PACKAGE_BYTES = 5 * GB;
export const MAX_WEB_PACKAGE_BYTES = 500 * MB;
export const MAX_WEB_OPFS_PACKAGE_BYTES = 5 * GB;

/** Um pacote com mais arquivos que isto é recusado antes de abrir. */
export const MAX_PACKAGE_FILES = 2000;

export type StorageLimitCode = "too_large" | "storage_full";

export class StorageLimitError extends Error {
  readonly code: StorageLimitCode;

  constructor(code: StorageLimitCode, message: string) {
    super(message);
    this.name = "StorageLimitError";
    this.code = code;
  }
}

/** Desktop ou web com OPFS: o teto é 5 GB. */
export function usesLargeFileLimit(): boolean {
  return Platform.isDesktop || opfsActive();
}

export function maxFileBytes(): number {
  if (Platform.isDesktop) return MAX_DESKTOP_FILE_BYTES;
  return opfsActive() ? MAX_WEB_OPFS_FILE_BYTES : MAX_WEB_FILE_BYTES;
}

export function maxPackageBytes(): number {
  if (Platform.isDesktop) return MAX_DESKTOP_PACKAGE_BYTES;
  return opfsActive() ? MAX_WEB_OPFS_PACKAGE_BYTES : MAX_WEB_PACKAGE_BYTES;
}

/** 5 GB / 500 MB, para mensagem ao operador. */
export function maxFileLabel(): string {
  return Platform.isDesktop || opfsActive() ? "5 GB" : "500 MB";
}

export function maxPackageLabel(): string {
  return Platform.isDesktop || opfsActive() ? "5 GB" : "500 MB";
}

/** Recusa um arquivo que passaria do teto da plataforma. */
export function assertFileFits(size: number): void {
  if (!Number.isFinite(size) || size <= 0) {
    throw new StorageLimitError("too_large", "Arquivo vazio ou inválido");
  }
  if (size > maxFileBytes()) {
    throw new StorageLimitError("too_large", `Arquivo maior que ${maxFileLabel()}`);
  }
}

/**
 * Confere a cota do navegador antes de gravar no IndexedDB. No desktop não há
 * cota de origem: quem decide é o espaço em disco do acervo.
 */
export async function assertWebQuota(size: number): Promise<void> {
  if (Platform.isDesktop) return;
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota === undefined) return;
  const free = estimate.quota - (estimate.usage || 0);
  if (size > free) {
    throw new StorageLimitError("storage_full", "Sem espaço no navegador para este arquivo");
  }
}
