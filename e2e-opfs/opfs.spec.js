import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test("OPFS de produção: Service Worker serve arquivo inteiro, Range e 404", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  const result = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const louvorja = await root.getDirectoryHandle("louvorja", { create: true });
    const media = await louvorja.getDirectoryHandle("media-library", { create: true });
    const record = await media.getDirectoryHandle("e2e_prod", { create: true });
    const handle = await record.getFileHandle("foto.png", { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array([1, 2, 3, 4, 5]));
    await writable.close();

    const url = "/__opfs/media-library/e2e_prod/foto.png";
    const full = await fetch(url);
    const fullBytes = new Uint8Array(await full.arrayBuffer());
    const range = await fetch(url, { headers: { Range: "bytes=1-3" } });
    const rangeBytes = new Uint8Array(await range.arrayBuffer());
    const missing = await fetch("/__opfs/media-library/e2e_prod/sumiu.png");
    const traversal = await fetch("/__opfs/media-library/../foto.png");

    await record.removeEntry("foto.png");
    await media.removeEntry("e2e_prod").catch(() => {});

    return {
      fullStatus: full.status,
      fullType: full.headers.get("Content-Type"),
      fullBytes: [...fullBytes],
      rangeStatus: range.status,
      rangeHeader: range.headers.get("Content-Range"),
      rangeBytes: [...rangeBytes],
      missingStatus: missing.status,
      traversalStatus: traversal.status,
    };
  });

  expect(result.fullStatus).toBe(200);
  expect(result.fullType).toBe("image/png");
  expect(result.fullBytes).toEqual([1, 2, 3, 4, 5]);
  expect(result.rangeStatus).toBe(206);
  expect(result.rangeHeader).toBe("bytes 1-3/5");
  expect(result.rangeBytes).toEqual([2, 3, 4]);
  expect(result.missingStatus).toBe(404);
  expect(result.traversalStatus).toBe(403);
});
