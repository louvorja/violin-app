import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import ptMusics from "./fixtures/pt_musics.json";
import music1 from "./fixtures/music_1.json";

async function offlineContext(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  // Every product response is local to this fixture. No telemetry, remote API,
  // images or fallback host can leave the browser during this regression.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (/\/pt_musics(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: ptMusics });
    if (/\/music_1(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: music1 });
    if (url.pathname.includes("/json_db/")) return route.fulfill({ json: [] });
    if (url.origin === "http://localhost:5002") return route.continue();
    return route.fulfill({ status: 204, body: "" });
  });
  return context;
}

async function openSong(page) {
  await page.goto("/");
  await page.locator("#ribbon-tab-collections").waitFor({ state: "visible", timeout: 20_000 });
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 15_000 });
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();
  const row = page.locator('[data-testid="music-row-1"]');
  await expect(row).toBeVisible();
  await row.hover();
  await row.locator('[data-testid="mmt-btn-no-audio"]').click();
  await expect(page.locator('[data-testid="slide-content"]').first()).toContainText("Aleluia");
}

async function projector(context) {
  const page = await context.newPage();
  await page.goto("/projection");
  await page.waitForFunction(() => !!window.__ljMusicShadowDiagnostics);
  return page;
}

async function navigate(page, index) {
  await page.evaluate((target) => {
    const channel = new BroadcastChannel("louvorja");
    channel.postMessage({ type: "go_to_slide", payload: { index: target } });
    channel.close();
  }, index);
}

async function diagnostics(page) {
  return page.evaluate(() => ({ ...window.__ljMusicShadowDiagnostics }));
}

for (const order of ["projector-first", "producer-first"]) {
  test(`music shadow compares across windows and recovers after reopen (${order})`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const context = await offlineContext(browser);
    try {
      let projection = order === "projector-first" ? await projector(context) : null;
      const main = await context.newPage();
      await openSong(main);
      projection ??= await projector(context);
      await expect(projection.locator('[data-testid="slide-content"]')).toContainText("Aleluia");
      await expect.poll(async () => (await diagnostics(projection)).comparisons).toBeGreaterThan(0);
      const initial = await diagnostics(projection);
      expect(initial.divergences).toBe(0);

      await navigate(projection, 1);
      await expect(projection.locator('[data-testid="slide-content"]')).toContainText(
        "Glória ao Senhor"
      );
      await expect
        .poll(async () => (await diagnostics(projection)).comparisons)
        .toBeGreaterThan(initial.comparisons);
      const navigated = await diagnostics(projection);
      expect(navigated.divergences).toBe(0);

      // All intermediate events are missed by the closed consumer. Mounting
      // again must request current state and actually compare the snapshot.
      await projection.close();
      await navigate(main, 0);
      await expect(main.locator('[data-testid="slide-content"]').first()).toContainText("Aleluia");
      await navigate(main, 1);
      await expect(main.locator('[data-testid="slide-content"]').first()).toContainText(
        "Glória ao Senhor"
      );
      projection = await projector(context);
      await expect(projection.locator('[data-testid="slide-content"]')).toContainText(
        "Glória ao Senhor"
      );
      await expect.poll(async () => (await diagnostics(projection)).comparisons).toBeGreaterThan(0);
      const recovered = await diagnostics(projection);
      expect(recovered.divergences).toBe(0);
      expect(recovered.sessionId).toBe(initial.sessionId);
      const evidencePath = test.info().outputPath("shadow-comparisons.json");
      await writeFile(
        evidencePath,
        JSON.stringify({ order, initial, navigated, recovered }, null, 2)
      );
      await test
        .info()
        .attach("shadow-comparisons", { path: evidencePath, contentType: "application/json" });
    } finally {
      await context.close();
    }
  });
}
