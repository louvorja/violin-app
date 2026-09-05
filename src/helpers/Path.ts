/** @category helper-puro — Constrói URLs do banco e arquivos. Seguro no Electron main process; sem APIs Vue. */
import Platform from "@/helpers/Platform";
import { API_URL_DB, API_URL_FILES } from "@/config/Api";

const DB_KEY_RE = /^[a-zA-Z0-9_-]+$/;

export default {
  /**
   * Constrói a URL para um arquivo do banco de dados JSON.
   *
   * No desktop (Electron): retorna louvorja://json_db/<path> — servido via
   *   protocolo customizado com cache local em userData/json_db/.
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
   *   protocolo customizado a partir de userData/files/ (populado em D3).
   * No web/PWA: retorna API_URL_FILES + <path> diretamente.
   *
   * @param path  Ex: "/audio/12345.mp3"
   */
  file(path: string): string {
    if (path.includes("..") || /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//i.test(path)) {
      throw new Error(`Path.file: caminho inválido "${path}"`);
    }
    if (Platform.isDesktop) {
      const p = path.startsWith("/") ? path : "/" + path;
      return "louvorja://files" + p;
    }
    if (!API_URL_FILES) {
      throw new Error(
        "Path.file: URL de arquivos não configurada. Configure VITE_URL_API no .env ou abra o app via Electron."
      );
    }
    return API_URL_FILES + path;
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
    const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
    const encoded = withSlash
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/");
    return "louvorja://local" + encoded;
  },
};
