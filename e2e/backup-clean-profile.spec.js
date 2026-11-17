import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test("backup completo restaura registro e mídia OPFS em perfil limpo e avisa quando arquivo falta", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  // Perfil A (origem): cria registro + bytes no OPFS (ou fallback) e exporta ZIP.
  const originContext = await browser.newContext({ serviceWorkers: "block" });
  await originContext.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await originContext.route("**/json_db/**", (route) => route.fulfill({ json: [] }));

  let backupBytes;
  let partialBytes;
  try {
    const pageA = await originContext.newPage();
    await pageA.goto("/");
    await pageA
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 30_000 });

    const exported = await pageA.evaluate(async (pngB64) => {
      const { DB_TABLE } = await import("/src/constants/DbTables.ts");
      const { default: idb } = await import("/src/helpers/IndexedDB.ts");
      const { writeOpfsStream, opfsPathOf, opfsUrl, removeOpfs, isOpfsSupported } =
        await import("/src/helpers/OpfsStore.ts");
      const { default: DatabaseBackup } = await import("/src/helpers/DatabaseBackup.ts");

      const pngBytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0));
      const rel = "media-library/clean_profile_1/foto-teste.png";
      let entry;
      if (isOpfsSupported()) {
        await writeOpfsStream(
          rel,
          new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(pngBytes);
              ctrl.close();
            },
          }),
          pngBytes.byteLength
        );
        entry = {
          id: "clean_profile_1",
          name: "Foto perfil limpo",
          type: "image",
          path: opfsPathOf(rel),
          url: opfsUrl(rel),
          mime: "image/png",
          addedAt: Date.now(),
        };
      } else {
        const blob = new Blob([pngBytes], { type: "image/png" });
        entry = {
          id: "clean_profile_1",
          name: "Foto perfil limpo",
          type: "image",
          data: blob,
          mime: "image/png",
          addedAt: Date.now(),
        };
      }
      await idb.put(DB_TABLE.MEDIA_LIBRARY, entry);

      // Captura o arquivo gravado pelo sink/download no navegador sem precisar de modal nativo.
      let capturedBlob = null;
      const origCreateObjectUrl = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj) => {
        if (obj instanceof Blob && obj.size > 0) capturedBlob = obj;
        return origCreateObjectUrl(obj);
      };
      try {
        const result = await DatabaseBackup.exportAll();
        if (!capturedBlob) throw new Error("Backup ZIP não foi emitido pelo sink web");
        const complete = Array.from(new Uint8Array(await capturedBlob.arrayBuffer()));

        // Agora cria uma entrada apontando para um arquivo OPFS ausente para provar aviso explícito.
        await removeOpfs("media-library/ausente_1/sumiu.jpg").catch(() => {});
        await idb.put(DB_TABLE.MEDIA_LIBRARY, {
          id: "ausente_1",
          name: "Ausente",
          type: "image",
          path: "opfs:media-library/ausente_1/sumiu.jpg",
          url: "/__opfs/media-library/ausente_1/sumiu.jpg",
          addedAt: Date.now(),
        });
        capturedBlob = null;
        const partialResult = await DatabaseBackup.exportAll();
        const partial = Array.from(new Uint8Array(await capturedBlob.arrayBuffer()));
        return {
          completeResult: result,
          complete,
          partialResult,
          partial,
        };
      } finally {
        URL.createObjectURL = origCreateObjectUrl;
      }
    }, SAMPLE_PNG.toString("base64"));

    expect(exported.completeResult.omittedFiles).toBeUndefined();
    expect(exported.partialResult.omittedFiles).toEqual(["media-library/ausente_1/sumiu.jpg"]);
    backupBytes = exported.complete;
    partialBytes = exported.partial;
  } finally {
    await originContext.close();
  }

  // Perfil B (limpo, novo contexto isolado sem banco nem OPFS prévio): restaura o backup e abre a mídia.
  const cleanContext = await browser.newContext({ serviceWorkers: "block" });
  await cleanContext.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await cleanContext.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  try {
    const pageB = await cleanContext.newPage();
    await pageB.goto("/");
    await pageB
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 30_000 });

    const restored = await pageB.evaluate(
      async ({ complete, partial, expectedBytes }) => {
        const { DB_TABLE } = await import("/src/constants/DbTables.ts");
        const { default: idb } = await import("/src/helpers/IndexedDB.ts");
        const { readOpfsFile, isOpfsSupported } = await import("/src/helpers/OpfsStore.ts");
        const { default: DatabaseBackup } = await import("/src/helpers/DatabaseBackup.ts");

        // Confirma perfil inicialmente limpo.
        const before = await idb.getAll(DB_TABLE.MEDIA_LIBRARY);
        if (before.length !== 0) throw new Error(`Perfil limpo já continha ${before.length} itens`);

        const fileComplete = new File([new Uint8Array(complete)], "backup.zip", {
          type: "application/zip",
        });
        const importRes = await DatabaseBackup.importAll(fileComplete);
        const rec = await idb.get(DB_TABLE.MEDIA_LIBRARY, "clean_profile_1");

        let restoredBytes = null;
        if (rec?.data instanceof Blob) {
          restoredBytes = Array.from(new Uint8Array(await rec.data.arrayBuffer()));
        } else if (
          isOpfsSupported() &&
          typeof rec?.path === "string" &&
          rec.path.startsWith("opfs:")
        ) {
          const f = await readOpfsFile(rec.path.slice("opfs:".length));
          if (f) restoredBytes = Array.from(new Uint8Array(await f.arrayBuffer()));
        }

        // Também verifica que importar o backup parcial propaga omittedFiles.
        const filePartial = new File([new Uint8Array(partial)], "partial.zip", {
          type: "application/zip",
        });
        const partialImport = await DatabaseBackup.importAll(filePartial);

        return {
          importRes,
          recName: rec?.name,
          bytesMatch:
            Array.isArray(restoredBytes) &&
            restoredBytes.length === expectedBytes.length &&
            restoredBytes.every((b, idx) => b === expectedBytes[idx]),
          partialOmitted: partialImport.omittedFiles,
        };
      },
      {
        complete: backupBytes,
        partial: partialBytes,
        expectedBytes: Array.from(SAMPLE_PNG),
      }
    );

    expect(restored.recName).toBe("Foto perfil limpo");
    expect(restored.bytesMatch).toBe(true);
    expect(restored.importRes.omittedFiles).toBeUndefined();
    expect(restored.partialOmitted).toEqual(["media-library/ausente_1/sumiu.jpg"]);
  } finally {
    await cleanContext.close();
  }
});
