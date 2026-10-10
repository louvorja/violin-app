/**
 * URL de uma imagem servida pelo desktop (capa de álbum, thumb de vídeo).
 *
 * `http(s)` (catálogo/ytimg) vai direto; caminho relativo (`/api/...`) é o
 * próprio desktop servindo o arquivo e ganha o token do controle remoto — o
 * host é o same-origin, então não precisa de absolutização.
 */
export function serverImageUrl(raw?: string | null, token?: string): string {
  if (!raw) return "";
  if (/^https?:\/\//.test(raw)) return raw;
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}token=${token ?? ""}`;
}
