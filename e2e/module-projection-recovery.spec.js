import { test, expect } from "@playwright/test";

test("module projection recovers a timer and ignores an older request reply", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/__module-state-fixture", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>producer</body></html>",
    })
  );
  try {
    const main = await context.newPage();
    await main.goto("/");
    await main
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 20_000 });
    const producer = await context.newPage();
    await producer.goto("/__module-state-fixture");
    await producer.evaluate(() => {
      const channel = new BroadcastChannel("louvorja");
      window.__modulePackets = [];
      channel.addEventListener("message", (event) => {
        if (event.data?.type === "module_projection_value")
          window.__modulePackets.push(event.data.payload);
      });
      window.__modulePublish = (text) =>
        channel.postMessage({
          type: "module_projection_intent",
          payload: { module: "timer", text, active: true },
        });
      window.__moduleRaw = (payload) =>
        channel.postMessage({
          type: "module_projection_value",
          payload,
        });
    });
    await producer.evaluate(() => window.__modulePublish("00:30"));
    await expect.poll(() => producer.evaluate(() => window.__modulePackets.length)).toBe(1);
    const first = await producer.evaluate(() => window.__modulePackets[0]);
    expect(first).toMatchObject({ module: "timer", module_schema: 1, module_revision: 1 });

    const projection = await context.newPage();
    await projection.goto("/projection/module?module=timer");
    await expect(projection.locator(".module-projection__text")).toHaveText("00:30");
    await producer.evaluate(() => window.__modulePublish("00:29"));
    await expect(projection.locator(".module-projection__text")).toHaveText("00:29");
    await producer.evaluate((old) => window.__moduleRaw(old), first);
    await producer.waitForTimeout(150);
    await expect(projection.locator(".module-projection__text")).toHaveText("00:29");

    await projection.close();
    const reopened = await context.newPage();
    await reopened.goto("/projection/module?module=timer");
    await expect(reopened.locator(".module-projection__text")).toHaveText("00:29");
  } finally {
    await context.close();
  }
});
