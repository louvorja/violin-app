import { test, expect } from "@playwright/test";

test("primary shell stamps Bible intents and serves the current verse to a late projection", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/__bible-state-fixture", (route) =>
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
    await producer.goto("/__bible-state-fixture");
    await producer.evaluate(() => {
      const channel = new BroadcastChannel("louvorja");
      window.__biblePackets = [];
      channel.addEventListener("message", (event) => {
        if (event.data?.type === "bible_verse") window.__biblePackets.push(event.data.payload);
      });
      window.__biblePublish = (text) =>
        channel.postMessage({
          type: "bible_verse_intent",
          payload: { text, reference: "João 3:16", active: true },
        });
      window.__bibleRaw = (payload) => channel.postMessage({ type: "bible_verse", payload });
    });
    await producer.evaluate(() => window.__biblePublish("Primeiro versículo"));
    await expect.poll(() => producer.evaluate(() => window.__biblePackets.length)).toBe(1);
    const first = await producer.evaluate(() => window.__biblePackets[0]);
    expect(first).toMatchObject({ bible_schema: 1, bible_revision: 1, text: "Primeiro versículo" });

    const projection = await context.newPage();
    await projection.goto("/projection/bible");
    await expect(projection.locator(".projection-bible-text")).toHaveText("Primeiro versículo");
    const obs = await context.newPage();
    await obs.goto("/obs/bible");
    await expect(obs.locator(".obs-bible-text")).toHaveText("Primeiro versículo");
    await producer.evaluate(() => window.__biblePublish("Versículo atual"));
    await expect(projection.locator(".projection-bible-text")).toHaveText("Versículo atual");
    await expect(obs.locator(".obs-bible-text")).toHaveText("Versículo atual");
    await expect
      .poll(() => producer.evaluate(() => window.__biblePackets.length))
      .toBeGreaterThanOrEqual(2);
    await producer.evaluate((old) => window.__bibleRaw(old), first);
    await producer.waitForTimeout(150);
    await expect(projection.locator(".projection-bible-text")).toHaveText("Versículo atual");
    await expect(obs.locator(".obs-bible-text")).toHaveText("Versículo atual");
  } finally {
    await context.close();
  }
});

test("Bible projection recovers on reopen and rejects a delayed old reply", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/__bible-state-fixture", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>Offline Bible state fixture</body></html>",
    })
  );

  const producer = await context.newPage();
  await producer.goto("/__bible-state-fixture");
  await producer.evaluate(() => {
    const current = {
      text: "Recovered verse",
      reference: "John 3:16",
      book: "John",
      book_id: 43,
      chapter: 3,
      verses: [16],
      version: "Fixture",
      version_id: 1,
      active: true,
      bible_schema: 1,
      bible_session: "fixture-1",
      bible_epoch: 100,
      bible_revision: 2,
    };
    const service = new BroadcastChannel("louvorja");
    const requester = new BroadcastChannel("louvorja");
    service.addEventListener("message", (event) => {
      if (event.data?.type !== "request_bible_state") return;
      const { delay = 0, reply = current } = window.__bibleReplyPlan || {};
      setTimeout(() => {
        service.postMessage({ type: "bible_verse", payload: reply });
        window.__bibleReplySent = true;
      }, delay);
    });
    window.__bibleChannels = { service, requester };
    window.__bibleReplyPlan = { delay: 0, reply: current };
    window.__requestBibleSnapshot = () =>
      requester.postMessage({ type: "request_bible_state", payload: { request_id: "test" } });
    window.__publishBibleVerse = (payload) => service.postMessage({ type: "bible_verse", payload });
  });

  try {
    const projection = await context.newPage();
    await projection.goto("/projection/bible");
    const text = projection.locator(".projection-bible-text");
    await expect(text).toHaveText("Recovered verse", { timeout: 10_000 });

    // A newly opened window asks the producer for the current verse and paints it.
    await projection.close();
    const reopened = await context.newPage();
    await reopened.goto("/projection/bible");
    await expect(reopened.locator(".projection-bible-text")).toHaveText("Recovered verse", {
      timeout: 10_000,
    });

    // Establish a newer selection, then emulate a delayed responder returning
    // an older snapshot for a state request. It must not replace the current verse.
    await producer.evaluate(() => {
      window.__publishBibleVerse({
        text: "New verse",
        reference: "John 3:17",
        book: "John",
        book_id: 43,
        chapter: 3,
        verses: [17],
        version: "Fixture",
        version_id: 1,
        active: true,
        bible_schema: 1,
        bible_session: "fixture-1",
        bible_epoch: 100,
        bible_revision: 3,
      });
    });
    await expect(reopened.locator(".projection-bible-text")).toHaveText("New verse");
    await producer.evaluate(() => {
      window.__bibleReplySent = false;
      window.__bibleReplyPlan = {
        delay: 200,
        reply: {
          text: "Old verse",
          reference: "John 3:15",
          book: "John",
          book_id: 43,
          chapter: 3,
          verses: [15],
          version: "Fixture",
          version_id: 1,
          active: true,
          bible_schema: 1,
          bible_session: "fixture-1",
          bible_epoch: 100,
          bible_revision: 1,
        },
      };
      window.__requestBibleSnapshot();
    });
    await expect.poll(() => producer.evaluate(() => window.__bibleReplySent)).toBe(true);
    await expect(reopened.locator(".projection-bible-text")).toHaveText("New verse", {
      timeout: 5_000,
    });
  } finally {
    await context.close();
  }
});
