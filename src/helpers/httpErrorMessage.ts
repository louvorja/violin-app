/**
 * Texto do erro de uma resposta HTTP.
 *
 * O desktop manda `error` pronto (ex.: "Device sem permissão de vídeos
 * online"); sem corpo/JSON, cai no status — sem isso a aba virava lista vazia
 * e o operador não sabia se era conteúdo ou falha.
 */
export async function httpErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* corpo não é JSON */
  }
  return `${fallback}: ${res.status}`;
}
