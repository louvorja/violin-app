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
