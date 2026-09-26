import { test, expect } from "@playwright/test";

test("overlay shortcut has one authority and a late projection rejects old visibility", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const operator = await context.newPage();
  const projection = await context.newPage();
  try {
    await operator.goto("/");
    await operator
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 15_000 });
    await operator.evaluate(() => {
      window.__overlayPackets = [];
      window.__overlayBus = new BroadcastChannel("louvorja");
      window.__overlayBus.addEventListener("message", (event) => {
        if (
          event.data?.type === "overlay_config_changed" &&
          Number.isSafeInteger(event.data.payload?.overlay_epoch)
        )
          window.__overlayPackets.push(event.data.payload);
      });
      window.__overlaySend = (type, payload) => window.__overlayBus.postMessage({ type, payload });
      window.__overlaySend("module_ribbon_action", { module: "overlay", action: "toggle" });
    });
    await expect
      .poll(() => operator.evaluate(() => window.__overlayPackets.at(-1) ?? null))
      .toMatchObject({ enabled: true });
    const epoch = await operator.evaluate(() => window.__overlayPackets.at(-1).overlay_epoch);

    await projection.goto("/projection");
    await expect(projection.locator(".overlay-canvas")).toBeVisible();
    await operator.evaluate(
      (oldEpoch) =>
        window.__overlaySend("overlay_config_changed", { enabled: false, overlay_epoch: oldEpoch }),
      epoch - 1
    );
    await projection.waitForTimeout(100);
    await expect(projection.locator(".overlay-canvas")).toBeVisible();

    await operator.evaluate(() =>
      window.__overlaySend("module_ribbon_action", { module: "overlay", action: "toggle" })
    );
    await expect
      .poll(() => operator.evaluate(() => window.__overlayPackets.at(-1)?.enabled))
      .toBe(false);
    await expect(projection.locator(".overlay-canvas")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("overlay replaces an image without retaining the old blob URL", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const operator = await context.newPage();
  const projection = await context.newPage();
  try {
    await projection.addInitScript(() => {
      window.__revokedBlobUrls = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => {
        window.__revokedBlobUrls.push(url);
        revoke(url);
      };
    });
    await operator.goto("/");
    await operator.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
    await operator.evaluate(async () => {
      const { saveImage, writeSlot } = await import("/src/helpers/Overlay.ts");
      const { createOverlaySlot } = await import("/src/types/Overlay.ts");
      for (const [id, color] of [
        ["image-a", "red"],
        ["image-b", "blue"],
      ]) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${color}"/></svg>`;
        await saveImage({
          id,
          name: id,
          path: "",
          data: new TextEncoder().encode(svg).buffer,
          mime: "image/svg+xml",
          size: svg.length,
          addedAt: Date.now(),
        });
      }
      await writeSlot(createOverlaySlot({ id: "image-slot", type: "image", file_id: "image-a" }));
      const bus = new BroadcastChannel("louvorja");
      bus.postMessage({
        type: "module_ribbon_action",
        payload: { module: "overlay", action: "toggle" },
      });
      bus.close();
    });
    await projection.goto("/projection");
    const img = projection.locator('[data-slot-id="image-slot"] img');
    await expect(img).toHaveAttribute("src", /^blob:/);
    const oldUrl = await img.getAttribute("src");

    await operator.evaluate(async () => {
      const { readAllSlots, writeSlot } = await import("/src/helpers/Overlay.ts");
      const slot = (await readAllSlots()).find((item) => item.id === "image-slot");
      await writeSlot({ ...slot, file_id: "image-b" });
      const bus = new BroadcastChannel("louvorja");
      bus.postMessage({ type: "request_overlay_state" });
      bus.close();
    });
    await expect.poll(() => img.getAttribute("src")).not.toBe(oldUrl);
    await expect
      .poll(() => projection.evaluate((url) => window.__revokedBlobUrls.includes(url), oldUrl))
      .toBe(true);
  } finally {
    await context.close();
  }
});
