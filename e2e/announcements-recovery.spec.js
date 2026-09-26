import { test, expect } from "@playwright/test";

test("announcement deck recovers its current index and rejects an older session", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/__announcement-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body>producer</body>" })
  );
  try {
    const main = await context.newPage();
    await main.goto("/");
    await main
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 20_000 });
    const producer = await context.newPage();
    await producer.goto("/__announcement-fixture");
    await producer.evaluate(() => {
      const channel = new BroadcastChannel("louvorja");
      window.__annPackets = [];
      window.__annPositions = [];
      channel.addEventListener("message", (event) => {
        if (event.data?.type === "announcements_state")
          window.__annPackets.push(event.data.payload);
        if (event.data?.type === "announcements_position")
          window.__annPositions.push(event.data.payload);
      });
      window.__annIntent = (session, epoch, prefix) =>
        channel.postMessage({
          type: "announcements_intent",
          payload: {
            announcement_session: session,
            announcement_epoch: epoch,
            slides: [
              { id: `${prefix}-1`, nome: "One", ordem: 1, texto: `${prefix} first` },
              { id: `${prefix}-2`, nome: "Two", ordem: 2, texto: `${prefix} second` },
            ],
            index: 0,
          },
        });
      window.__annRaw = (payload) => channel.postMessage({ type: "announcements_state", payload });
      window.__annMediaClose = () => channel.postMessage({ type: "media_close", payload: {} });
      window.__annControl = (action, session) =>
        channel.postMessage({
          type: "announcements_control",
          payload: { action, announcement_session: session },
        });
    });

    await producer.evaluate(() => window.__annIntent("old", 100, "Old"));
    await expect.poll(() => producer.evaluate(() => window.__annPackets.length)).toBe(1);
    const old = await producer.evaluate(() => window.__annPackets[0]);
    await producer.evaluate(() => window.__annIntent("current", 101, "Current"));
    await expect.poll(() => producer.evaluate(() => window.__annPackets.length)).toBe(2);

    const stage = await context.newPage();
    await stage.goto("/projection/announcements");
    await expect(stage.locator(".ann-text")).toHaveText("Current first");
    await stage.keyboard.press("ArrowRight");
    await expect(stage.locator(".ann-text")).toHaveText("Current second");
    const position = await producer.evaluate(() => window.__annPositions.at(-1));
    expect(position).toMatchObject({
      announcement_session: "current",
      index: 1,
      announcement_revision: 2,
    });
    expect(position.slides).toBeUndefined();
    await producer.evaluate(() => {
      window.__annControl("prev", "old");
      window.__annRaw(window.__annPackets[0]);
    });
    await expect(stage.locator(".ann-text")).toHaveText("Current second");

    await stage.close();
    const reopened = await context.newPage();
    await reopened.goto("/projection/announcements");
    await expect(reopened.locator(".ann-text")).toHaveText("Current second");
    await producer.evaluate((packet) => window.__annRaw(packet), old);
    await expect(reopened.locator(".ann-text")).toHaveText("Current second");

    await producer.evaluate(() => window.__annMediaClose());
    await expect(reopened.locator(".ann-text")).toHaveCount(0);
    const afterClose = await context.newPage();
    await afterClose.goto("/projection/announcements");
    await expect(afterClose.locator(".ann-text")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
