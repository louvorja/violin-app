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
