/** @category helper-puro — Constrói URLs do banco e arquivos. Seguro no Electron main process; sem APIs Vue. */
import Platform from "@/helpers/Platform";
import { API_URL_DB } from "@/config/Api";
import { encodeMediaPath, resolveMediaReference } from "@/helpers/MediaUrl";
import { opfsUrl } from "@/helpers/OpfsStore";

const DB_KEY_RE = /^[a-zA-Z0-9_-]+$/;

export default {
  /**
   * Constrói a URL para um arquivo do banco de dados JSON.
   *
   * No desktop (Electron): retorna louvorja://json_db/<path> — servido via
   *   protocolo customizado com cache local em <dados>/json_db/.
   * No web/PWA: retorna API_URL_DB + <path> diretamente.
   *
   * @param path  Ex: "/pt_musics" ou "/music_123"
   */
  db(path: string): string {
    const key = path.startsWith("/") ? path.slice(1) : path;
    if (!DB_KEY_RE.test(key)) {
      throw new Error(`Path.db: chave inválida "${key}"`);
    }
    if (Platform.isDesktop) {
      return "louvorja://json_db/" + key;
    }
    if (!API_URL_DB) {
      throw new Error(
        "Path.db: URL da API não configurada. Configure VITE_URL_API no .env ou abra o app via Electron."
      );
    }
    return API_URL_DB + "/" + key;
  },

  /**
   * Constrói a URL para um arquivo de mídia (áudio, imagem, etc.).
   *
   * No desktop (Electron): retorna louvorja://files/<path> — servido via
   *   protocolo customizado a partir de <dados>/files/ (populado em D3).
   * No web/PWA: retorna API_URL_FILES + <path> diretamente.
   *
   * @param path  Ex: "/audio/12345.mp3"
   */
  file(path: string): string {
    const reference = resolveMediaReference(path);
    if (!reference) {
      throw new Error(`Path.file: caminho inválido "${path}"`);
    }
    if (Platform.isDesktop) {
      const source = /^https?:\/\//i.test(path.trim())
        ? `?source=${encodeURIComponent(reference.url)}`
        : "";
      return `louvorja://files${encodeMediaPath(reference.relativePath)}${source}`;
    }
    return reference.url;
  },

  /**
   * URL reproduzível de um caminho guardado em registro (biblioteca, liturgia).
   *
   * Aceita as três formas que o banco tem hoje:
   *   - esquema pronto (`blob:`, `data:`, `http(s)`, `louvorja://`, `file:`) → passa;
   *   - caminho absoluto do aparelho (legado) → `louvorja://local/...`;
   *   - caminho relativo do acervo (`media-library/...`) → `louvorja://files/...`.
   *
   * O relativo é o que sobrevive a mudar a pasta do acervo: o protocolo resolve
   * contra a raiz atual, não contra a raiz de quando o registro foi criado.
   */
  media(value: string): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^opfs:/i.test(raw)) return opfsUrl(raw);
    if (/^(blob|data|https?|louvorja|file):/i.test(raw)) return raw;
    const absolute = raw.startsWith("/") || raw.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(raw);
    // Caminho absoluto só é reproduzível no desktop; no navegador ele volta
    // como veio (registro antigo que não tem outra forma de abrir).
    if (absolute) return Platform.isDesktop ? this.local(raw) : raw;
    try {
      return this.file(raw);
    } catch {
      // Sem API de arquivos configurada (web) um caminho relativo antigo não
      // tem para onde ir; devolver cru é melhor que derrubar a tela.
      return raw;
    }
  },

  /**
   * Converte um caminho absoluto de arquivo local para URL do protocolo
   * louvorja://local/... Usado pelo seletor de arquivos em FieldImage, Opções, etc.
   *
   * Ex: "/Users/user/image.jpg"    → "louvorja://local/Users/user/image.jpg"
   *     "C:\\Users\\user\\img.jpg" → "louvorja://local/C:/Users/user/img.jpg"
   */
  local(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    // Cada segmento é codificado: `#`, `?` e `%` no nome truncavam ou quebravam a URL.
    const encode = (path: string): string => path.split("/").map(encodeURIComponent).join("/");
    // Windows: C:/Users/... → louvorja://local/C:/Users/...
    const drive = normalized.match(/^([A-Za-z]:)\/(.*)$/);
    if (drive) {
      return `louvorja://local/${drive[1]}/${encode(drive[2])}`;
    }
    // Unix: /Users/... → louvorja://local/Users/...
    return "louvorja://local" + encode(normalized);
  },
};
