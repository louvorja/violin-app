import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("avisos: mídia antiga vira Blob, upload grava Blob e o telão exibe", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  try {
    const page = await context.newPage();
    await page.addLocatorHandler(page.getByRole("dialog", { name: /Dica do LouvorJA/ }), (d) =>
      d.getByRole("contentinfo").getByRole("button", { name: "Fechar" }).click()
    );
    await page.goto("/");
    await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });

    await page.evaluate(async (b64) => {
      const { default: idb } = await import("/src/helpers/IndexedDB.ts");
      const { DB_TABLE } = await import("/src/constants/DbTables.ts");
      const { default: WebRoles } = await import("/src/helpers/projection/WebRoles.ts");
      WebRoles.setRole("projection", "current");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await idb.put(DB_TABLE.ANNOUNCEMENTS, {
        id: "legacy",
        nome: "Aviso antigo",
        ordem: 1,
        texto: "Bem-vindos",
        imageData: bytes.buffer,
        imageMime: "image/png",
        style: { bgColor: "#000000", textColor: "#ffffff", fontSize: 64, align: "center" },
      });
    }, PNG_1X1);

    await page.getByRole("tab", { name: "Culto" }).click();
    await page.locator('[data-testid="ribbon-btn-announcements"]').click();
    await page.locator(".an-item", { hasText: "Aviso antigo" }).click();

    const preview = page.locator("img.an-preview-media");
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => preview.evaluate((img) => img.naturalWidth)).toBe(1);

    const stored = () =>
      page.evaluate(async () => {
        const { default: idb } = await import("/src/helpers/IndexedDB.ts");
        const { DB_TABLE } = await import("/src/constants/DbTables.ts");
        const rec = await idb.get(DB_TABLE.ANNOUNCEMENTS, "legacy");
        const kind = (v) =>
          v instanceof Blob ? "Blob" : v instanceof ArrayBuffer ? "ArrayBuffer" : typeof v;
        return {
          image: kind(rec.imageData),
          video: kind(rec.videoData),
          videoSize: rec.videoData?.size,
        };
      });
    expect((await stored()).image).toBe("Blob");

    const video = Buffer.alloc(256 * 1024, 7);
    await page
      .locator('input[type="file"][accept="video/*"]')
      .setInputFiles({ name: "aviso.mp4", mimeType: "video/mp4", buffer: video });
    await expect.poll(async () => (await stored()).video).toBe("Blob");
    expect((await stored()).videoSize).toBe(video.length);
    await expect(page.locator("video.an-preview-media")).toHaveAttribute("src", /^blob:/);

    const projectionOpening = context.waitForEvent("page");
    await page.getByRole("button", { name: "Projetar" }).click();
    const projection = await projectionOpening;
    await expect(projection).toHaveURL(/\/projection\/announcements$/);
    await expect(projection.locator("video.ann-media")).toHaveAttribute("src", /^blob:/);
    await expect(projection.locator(".ann-text")).toHaveText("Bem-vindos");
  } finally {
    await context.close();
  }
});
