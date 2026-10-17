import { ref } from "vue"
import { fetchWithTimeout, type FetchOptions } from "@/helpers/Http"

export const isTokenInvalid = ref(false)

export async function apiFetch(input: RequestInfo | URL, init?: FetchOptions): Promise<Response> {
  const res = await fetchWithTimeout(input, { source: "remote-api", ...init })
  if (res.status === 401) {
    isTokenInvalid.value = true
    throw new Error("Token inválido")
  }
  return res
}

export function postApi(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<Response> {
  const url = token ? `${path}?token=${token}` : path
  return apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * POST de bytes crus (upload do celular para o desktop).
 *
 * De propósito **sem** `Content-Type: application/json`: o `express.json()`
 * global do servidor tem limite de 100 kb e consumiria o stream — com
 * `application/octet-stream` ele passa reto e a rota de upload faz o pipe
 * direto para o disco.
 */
export function postRaw(
  path: string,
  body: ArrayBuffer,
  token?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = token ? `${path}?token=${token}` : path
  return apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...headers },
    body,
  })
}
