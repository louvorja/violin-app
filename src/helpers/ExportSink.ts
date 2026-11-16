/**
 * Destino de um arquivo compactado (pacote da liturgia ou backup).
 *
 * Desktop: diálogo do sistema + main gravando em streaming.
 * Web com OPFS: arquivo temporário no OPFS e download de um `File` apoiado em
 * disco (o Chromium streama, sem carregar 5 GB na memória).
 * Web sem OPFS: Blob em memória, com o limite de 500 MB do fallback.
 *
 * @category helper-puro — usa IPC/OPFS e DOM.
 */
import Platform from "@/helpers/Platform";
import { createOpfsWriter, isOpfsSupported, removeOpfs } from "@/helpers/OpfsStore";

export interface ExportSink {
  stream: WritableStream<Uint8Array>;
  commit: () => Promise<void>;
  abort: () => Promise<void>;
}

export type ExportKind = "liturgy" | "backup";

const MIME: Record<ExportKind, string> = {
  liturgy: "application/x-louvorja-liturgy",
  backup: "application/zip",
};

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.click();
  // Revogar no mesmo passo do clique cancela o download em alguns Chromium.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function createExportSink(
  fileName: string,
  kind: ExportKind = "liturgy"
): Promise<ExportSink | null> {
  const desktop = Platform.api as LouvorjaApi | null;
  if (Platform.isDesktop && desktop?.libraryExport) {
    const session = await desktop.libraryExport.choose({ suggestedName: fileName, kind });
    if (!session) return null;
    return {
      stream: new WritableStream<Uint8Array>({
        write: (chunk) => desktop.libraryExport.write(session.token, chunk).then(() => {}),
        close: async () => {
          await desktop.libraryExport.end(session.token);
        },
        abort: async () => {
          await desktop.libraryExport.abort(session.token);
        },
      }),
      commit: async () => {},
      abort: async () => {
        await desktop.libraryExport.abort(session.token).catch(() => {});
      },
    };
  }

  // Exportar não precisa do Service Worker (só gravar e baixar um File);
  // o OPFS já resolve memória mesmo antes de ele controlar a página.
  if (isOpfsSupported()) {
    const ext = kind === "backup" ? "zip" : "llja";
    const writer = await createOpfsWriter(`liturgy-temp/${crypto.randomUUID()}.${ext}`);
    return {
      stream: writer.writable,
      commit: async () => {
        const file = await writer.commit();
        download(file, fileName);
        // O objectURL ainda está segurando o File; o temporário pode sair depois.
        setTimeout(() => void removeOpfs(writer.rel, true).catch(() => {}), 60_000);
      },
      abort: async () => {
        await writer.abort().catch(() => {});
      },
    };
  }

  const chunks: BlobPart[] = [];
  return {
    stream: new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk as BlobPart);
      },
    }),
    commit: async () => {
      download(new Blob(chunks, { type: MIME[kind] }), fileName);
    },
    abort: async () => {
      chunks.length = 0;
    },
  };
}
