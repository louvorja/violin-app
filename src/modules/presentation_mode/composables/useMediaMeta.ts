import { reactive } from "vue";
import $path from "@/helpers/Path";
import { fileKind, type LibraryEntry } from "./useFileLibrary";

/**
 * Miniatura, duração e resolução dos arquivos do navegador, lidas no próprio
 * renderer: a imagem pelo `<img>`, o vídeo e o áudio pelo `<video>`/`<audio>`
 * com `preload="metadata"`, e o quadro do vídeo desenhado num canvas.
 *
 * Uma pasta pode ter dezenas de vídeos; abrir todos de uma vez trava a janela
 * do operador. A fila lê dois por vez e guarda o resultado para a sessão.
 */

export interface MediaMeta {
  /** URL para a miniatura: a própria imagem, ou o quadro do vídeo em data URL. */
  thumb?: string;
  duration?: number;
  width?: number;
  height?: number;
  failed?: boolean;
}

const THUMB_WIDTH = 320;
const CONCURRENCY = 2;
const TIMEOUT_MS = 8000;

const _meta = reactive(new Map<string, MediaMeta>());
const _queue: LibraryEntry[] = [];
const _queued = new Set<string>();
let _running = 0;

function _withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
  ]);
}

function _readImage(url: string): Promise<MediaMeta> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ thumb: url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

function _readVideo(url: string, withFrame: boolean): Promise<MediaMeta> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(withFrame ? "video" : "audio") as HTMLVideoElement;
    el.muted = true;
    // Sem CORS o quadro desenhado "contamina" o canvas e o toDataURL falha.
    el.crossOrigin = "anonymous";
    el.preload = withFrame ? "auto" : "metadata";
    const cleanup = () => {
      el.removeAttribute("src");
      el.load();
    };
    el.onerror = () => {
      cleanup();
      reject(new Error("media"));
    };
    el.onloadedmetadata = () => {
      const base: MediaMeta = {
        duration: Number.isFinite(el.duration) ? el.duration : undefined,
        width: withFrame ? el.videoWidth : undefined,
        height: withFrame ? el.videoHeight : undefined,
      };
      if (!withFrame) {
        cleanup();
        resolve(base);
        return;
      }
      // Um segundo adiante evita o quadro preto de abertura; vídeo curto usa o meio.
      el.currentTime = Math.min(1, (el.duration || 2) / 2);
      el.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          const ratio = el.videoHeight / el.videoWidth || 9 / 16;
          canvas.width = THUMB_WIDTH;
          canvas.height = Math.round(THUMB_WIDTH * ratio);
          canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
          base.thumb = canvas.toDataURL("image/jpeg", 0.7);
        } catch {
          /* sem quadro: a grade mostra o ícone */
        }
        cleanup();
        resolve(base);
      };
    };
    el.src = url;
  });
}

async function _load(entry: LibraryEntry): Promise<MediaMeta> {
  const url = $path.local(entry.path);
  const kind = fileKind(entry.ext);
  if (kind === "image") return _readImage(url);
  if (kind === "video") return _readVideo(url, true);
  if (kind === "audio") return _readVideo(url, false);
  return {};
}

function _pump(): void {
  while (_running < CONCURRENCY && _queue.length) {
    const entry = _queue.shift()!;
    _running++;
    _withTimeout(_load(entry))
      .then((meta) => _meta.set(entry.path, meta))
      .catch(() => _meta.set(entry.path, { failed: true }))
      .finally(() => {
        _running--;
        _queued.delete(entry.path);
        _pump();
      });
  }
}

/** Uma entrada mínima para um arquivo que só se conhece pelo caminho (filho de um momento). */
function entryOf(path: string): LibraryEntry {
  const name = path.split(/[\\/]/).pop() ?? path;
  return { name, path, isDir: false, ext: name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "", size: 0, mtimeMs: 0 };
}

function request(entry: LibraryEntry, { priority = false } = {}): void {
  if (entry.isDir || _meta.has(entry.path) || _queued.has(entry.path)) return;
  if (!["image", "video", "audio"].includes(fileKind(entry.ext) ?? "")) return;
  _queued.add(entry.path);
  if (priority) _queue.unshift(entry);
  else _queue.push(entry);
  _pump();
}

/** Miniatura de um arquivo pelo caminho; pede a leitura na primeira vez. */
function thumbOf(path: string): string | undefined {
  if (!_meta.has(path)) request(entryOf(path));
  return _meta.get(path)?.thumb;
}

export function useMediaMeta() {
  return { meta: _meta, thumbOf, request };
}
