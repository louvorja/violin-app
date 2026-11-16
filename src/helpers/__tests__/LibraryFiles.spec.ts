import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  platform: {
    isDesktop: true,
    api: null as {
      libraryFiles?: { prune: (known: string[]) => Promise<{ removed: number }> } | null;
    } | null,
  },
}));

vi.mock("@/helpers/Platform", () => ({ default: h.platform }));

async function load() {
  vi.resetModules();
  return import("@/helpers/LibraryFiles");
}

beforeEach(() => {
  h.platform.isDesktop = true;
  h.platform.api = null;
});

describe("LibraryFiles — caminhos gerenciados", () => {
  it("reconhece o caminho relativo e extrai a cauda de um absoluto antigo", async () => {
    const { managedLibraryRel, isManagedLibraryPath } = await load();
    expect(managedLibraryRel("media-library/file_1/foto.png")).toBe(
      "media-library/file_1/foto.png"
    );
    expect(managedLibraryRel("opfs:background-sound/abc/audio.mp3")).toBe(
      "background-sound/abc/audio.mp3"
    );
    // Registro antigo com caminho completo: o prune ainda precisa reconhecer.
    expect(managedLibraryRel("C:\\Acervo\\media-library\\file_1\\foto.png")).toBe(
      "media-library/file_1/foto.png"
    );
    expect(managedLibraryRel("louvorja://local/Users/x/background-projection/id/capa.jpg")).toBe(
      "background-projection/id/capa.jpg"
    );
    expect(isManagedLibraryPath("media-library/file_1/foto.png")).toBe(true);
    expect(isManagedLibraryPath("musics/qualquer.mp3")).toBe(false);
  });

  it("prune manda ao main só caminhos normalizados das quatro pastas", async () => {
    const prune = vi.fn(async () => ({ removed: 2 }));
    h.platform.api = { libraryFiles: { prune } };
    const { pruneLibraryFiles } = await load();
    const removed = await pruneLibraryFiles([
      "media-library/id/foto.png",
      "C:\\Acervo\\liturgy-files\\lf-1\\anexo.pdf",
      "musics/qualquer.mp3",
      "lixo/fora.txt",
    ]);
    expect(removed).toBe(2);
    expect(prune).toHaveBeenCalledWith([
      "media-library/id/foto.png",
      "liturgy-files/lf-1/anexo.pdf",
    ]);
  });
});
