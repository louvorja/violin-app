import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.use({ serviceWorkers: "block" });

for (const kind of ["audio", "image"]) {
  test(`a biblioteca de ${kind} preserva os bytes se o arquivo mudar durante a importação`, async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "louvorja-file-snapshot-"));
    const filename = join(directory, kind === "audio" ? "sample.mp3" : "sample.png");
    const original = "bytes originais do arquivo selecionado";
    await writeFile(filename, original);
    try {
      // Usa File e IndexedDB reais; só segura a consulta entre o hash e a escrita.
      await page.route(
        (url) => url.pathname === "/",
        (route) => route.fulfill({ contentType: "text/html", body: '<input type="file">' })
      );
      await page.goto("/");
      await page.locator("input").setInputFiles(filename);
      await page.evaluate(async (kind) => {
        const library = await import("/src/helpers/AudioLibrary.ts");
        const { default: idb } = await import("/src/helpers/IndexedDB.ts");
        const originalGet = idb.get.bind(idb);
        idb.get = async (...args) => {
          window.hashComplete = true;
          await new Promise((resolve) => {
            window.continueImport = resolve;
          });
          return originalGet(...args);
        };
        const importFile = kind === "audio" ? library.importAudio : library.importImage;
        const readBlob = kind === "audio" ? library.getAudioBlob : library.getImageBlob;
        window.importResult = (async () => {
          try {
            const token = await importFile(document.querySelector("input").files[0]);
            idb.get = originalGet;
            const blob = await readBlob(token);
            return { token, bytes: await blob.text() };
          } catch (error) {
            return { error: error.name, message: error.message };
          } finally {
            idb.get = originalGet;
          }
        })();
      }, kind);
      await page.waitForFunction(() => window.hashComplete);
      await writeFile(filename, "conteúdo alterado enquanto o banco era consultado");
      await page.evaluate(() => window.continueImport());

      const result = await page.evaluate(() => window.importResult);
      const hash = createHash("sha256").update(original).digest("hex");
      expect(result).toEqual({
        token: `lib://${kind}/${hash}.${kind === "audio" ? "mp3" : "png"}`,
        bytes: original,
      });
    } finally {
      await page.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
