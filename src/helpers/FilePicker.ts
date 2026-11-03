/**
 * @category helper-puro — Seleção de arquivos de imagem com retorno de URL persistente.
 *
 * Desktop (Electron): usa Platform.api.storage.chooseImage()
 *   → retorna "louvorja://local/..." (processado pelo protocolo customizado)
 *
 * Web/PWA: cria input file + FileReader.readAsDataURL()
 *   → retorna "data:image/...;base64,..." (auto-contido, sobrevive a reload)
 */

import Platform from "@/helpers/Platform";
import $path from "@/helpers/Path";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";

type ImagePicker = {
  storage?: {
    chooseImage?: () => Promise<string | string[] | null>;
    chooseFile?: (kind: string) => Promise<string | string[] | null>;
  };
};

/**
 * Abre o seletor de imagens e retorna uma URL persistente para o arquivo escolhido.
 * Retorna null se o usuário cancelar.
 */
export async function pickImage(): Promise<string | null> {
  const api = (Platform.api as ImagePicker) || null;

  if (Platform.isDesktop && api?.storage?.chooseImage) {
    try {
      const result = await api.storage.chooseImage();
      if (!result) return null;
      const filePath = Array.isArray(result) ? result[0] : result;
      return $path.local(filePath);
    } catch (e) {
      console.warn("[FilePicker] chooseImage falhou, fallback web:", e);
    }
  }

  // Web fallback
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}

/**
 * Fundo de módulo: aceita imagem, GIF ou vídeo. No desktop usa o diálogo de
 * mídia da Biblioteca (imagem/vídeo); no web lê o arquivo como data URL.
 */
export async function pickBackgroundMedia(): Promise<string | null> {
  const api = (Platform.api as ImagePicker) || null;

  if (Platform.isDesktop && api?.storage?.chooseFile) {
    try {
      const result = await api.storage.chooseFile("background");
      if (!result) return null;
      const filePath = Array.isArray(result) ? result[0] : result;
      // "Todos os arquivos" ainda permite escolher áudio/PDF; o fundo do
      // módulo só renderiza imagem/GIF/vídeo.
      if (!/\.(jpe?g|png|webp|gif|bmp|svg|mp4|webm|mkv|mov|avi|m4v)$/i.test(filePath)) {
        return null;
      }
      return $path.local(filePath);
    } catch (e) {
      console.warn("[FilePicker] chooseFile falhou:", e);
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}

/**
 * Abre o seletor de imagens e retorna o ArrayBuffer + MIME do arquivo selecionado.
 * Útil para armazenar a imagem no IndexedDB via SettingsStorage.
 */
export async function pickImageData(): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const api = (Platform.api as ImagePicker) || null;

  if (Platform.isDesktop && api?.storage?.chooseImage) {
    try {
      const result = await api.storage.chooseImage();
      if (!result) return null;
      const filePath = Array.isArray(result) ? result[0] : result;
      const res = await fetchWithTimeout($path.local(filePath), {
        timeout: NET_TIMEOUT.MEDIA,
        source: "file",
      });
      return {
        data: await res.arrayBuffer(),
        mime: res.headers.get("content-type") || "image/png",
      };
    } catch (e) {
      console.warn("[FilePicker] chooseImage falhou, fallback web:", e);
    }
  }

  // Web fallback
  const file = await pickFileViaInput();
  if (!file) return null;
  return { data: await file.arrayBuffer(), mime: file.type || "image/png" };
}

async function pickFileViaInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}

/**
 * Fundo de slide: imagem, GIF ou vídeo, com os bytes para salvar no IndexedDB.
 * O fundo do slide é uma mídia autocontida (não um caminho), para sobreviver à
 * sessão e funcionar na projeção.
 */
export async function pickMediaData(): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const api = (Platform.api as ImagePicker) || null;
  const allowed = /\.(jpe?g|png|webp|gif|bmp|svg|mp4|webm|mkv|mov|avi|m4v)$/i;

  if (Platform.isDesktop && api?.storage?.chooseFile) {
    try {
      const result = await api.storage.chooseFile("media");
      if (!result) return null;
      const filePath = Array.isArray(result) ? result[0] : result;
      if (!allowed.test(filePath)) return null;
      const res = await fetchWithTimeout($path.local(filePath), {
        timeout: NET_TIMEOUT.MEDIA,
        source: "file",
      });
      return {
        data: await res.arrayBuffer(),
        mime: res.headers.get("content-type") || "application/octet-stream",
      };
    } catch (e) {
      console.warn("[FilePicker] chooseFile(mídia) falhou:", e);
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.style.display = "none";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({
        data: await file.arrayBuffer(),
        mime: file.type || "application/octet-stream",
      });
    };
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}

/**
 * Lê um arquivo File como Data URL (base64) — útil para drag-and-drop ou
 * quando o File já existe sem precisar abrir o seletor.
 */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
